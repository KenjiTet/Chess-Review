# Chess Blunder Trainer — Complete Technical Documentation

**Project name:** Chess Review  
**Stack:** Python 3 / FastAPI (backend) + React 19 / TypeScript / Vite (frontend)  
**Purpose:** Fetch a player's Chess.com games, analyse them with Stockfish, and turn each blunder into an interactive training position.

---

## Table of contents

1. [Repository layout](#1-repository-layout)
2. [Running the project](#2-running-the-project)
3. [Backend architecture](#3-backend-architecture)
   - 3.1 Entry point (`main.py`)
   - 3.2 Pydantic models (`models.py`)
   - 3.3 Routers
   - 3.4 Services
4. [Frontend architecture](#4-frontend-architecture)
   - 4.1 Entry point
   - 4.2 API client
   - 4.3 Zustand stores (hooks)
   - 4.4 Components
   - 4.5 Utilities
5. [End-to-end data flows](#5-end-to-end-data-flows)
6. [Caching strategy](#6-caching-strategy)
7. [Move classification system](#7-move-classification-system)
8. [State persistence (localStorage)](#8-state-persistence-localstorage)
9. [Coding standards](#9-coding-standards)
10. [Known limitations and TODOs](#10-known-limitations-and-todos)

---

## 1. Repository layout

```
Chess Review v2/
├── backend/
│   ├── main.py                        # FastAPI app + CORS + router registration
│   ├── models.py                      # Pydantic request/response contracts
│   ├── requirements.txt               # Python dependencies
│   ├── .env                           # STOCKFISH_PATH (not committed)
│   ├── users.json                     # User accounts (plaintext passwords — v1)
│   ├── cache/
│   │   └── analysis_cache.json        # Stockfish results keyed by Chess.com URL
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── auth.py                    # POST /api/auth/login|register
│   │   ├── games.py                   # GET  /api/games, /api/games/history
│   │   ├── session.py                 # GET/POST /api/session/* (core training)
│   │   └── analysis.py                # POST/GET /api/analysis/*
│   └── services/
│       ├── __init__.py
│       ├── cache.py                   # JSON cache read/write helpers
│       ├── chess_com.py               # Chess.com Public API client
│       ├── stockfish.py               # Engine analysis, evaluation, classification
│       ├── trainer.py                 # Session building, attempt scoring
│       └── users.py                   # User CRUD (plaintext JSON file)
│
└── frontend/
    ├── index.html                     # Vite HTML shell
    ├── vite.config.ts                 # Vite config + /api proxy to :8000
    ├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
    ├── package.json                   # npm scripts and dependencies
    ├── public/
    │   ├── favicon.svg                # App favicon
    │   └── icons.svg                  # Shared icon sprite
    └── src/
        ├── main.tsx                   # ReactDOM.createRoot entry
        ├── App.tsx                    # Screen router (login/setup/loading/trainer)
        ├── App.css / index.css        # Global styles + CSS variables
        ├── TimeClassIcons.tsx         # SVG icon map for chess time classes
        ├── api/
        │   └── client.ts              # Typed fetch wrapper for every endpoint
        ├── hooks/
        │   ├── useAuth.ts             # Auth state (Zustand, persisted)
        │   ├── useSession.ts          # Training session state (ephemeral)
        │   ├── useSettings.ts         # App settings (Zustand, persisted per user)
        │   ├── useFavorites.ts        # Saved positions (Zustand, persisted per user)
        │   ├── useReviewed.ts         # Reviewed game URLs (Zustand, persisted per user)
        │   └── useChessCom.ts         # Chess.com data fetching hook
        ├── components/
        │   ├── Login/Login.tsx|css
        │   ├── SessionSetup/SessionSetup.tsx|css
        │   ├── Loading/Loading.tsx|css
        │   ├── Trainer/Trainer.tsx|css
        │   ├── Board/Board.tsx|css
        │   ├── EvalBar/EvalBar.tsx|css
        │   ├── BlunderCard/BlunderCard.tsx|css
        │   ├── MoveLog/MoveLog.tsx|css
        │   ├── Reveal/Reveal.tsx|css
        │   ├── Summary/Summary.tsx|css
        │   ├── Favorites/Favorites.tsx|css
        │   ├── GameHistory/GameHistory.tsx|css
        │   ├── PlayerBanner/PlayerBanner.tsx|css
        │   └── ErrorBanner/ErrorBanner.tsx|css
        ├── sounds/
        │   └── Move.mp3               # Move sound effect audio file
        ├── utils/
        │   ├── sounds.ts              # Audio feedback on moves (imports Move.mp3)
        │   └── generateBoardImage.ts  # Canvas PNG export for saved positions
        └── assets/
            ├── bg-dark.png / bg-light.png
            └── hero.png
```

---

## 2. Running the project

### Prerequisites
- Python 3.11+
- Node.js 20+
- Stockfish binary (any modern version)

### Backend
```bash
cd backend

# Create virtual environment (recommended)
python -m venv .venv
.venv\Scripts\activate          # Windows
source .venv/bin/activate       # macOS / Linux

pip install -r requirements.txt

# Create .env with your Stockfish path
echo STOCKFISH_PATH=C:/path/to/stockfish.exe > .env

uvicorn main:app --reload
# API: http://localhost:8000
# Swagger UI: http://localhost:8000/docs
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# Dev server: http://localhost:5173
# All /api/* calls are proxied automatically to http://localhost:8000
```

---

## 3. Backend architecture

### 3.1 Entry point — `backend/main.py`

```python
load_dotenv()   # Must be first so STOCKFISH_PATH reaches every service module
app = FastAPI(title="BlunderDrill — Chess Blunder Trainer API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], ...)
app.include_router(auth.router,     prefix="/api/auth")
app.include_router(session.router,  prefix="/api/session")
app.include_router(games.router,    prefix="/api/games")
app.include_router(analysis.router, prefix="/api/analysis")
```

CORS is fully open (`*`) for local development. In production this must be tightened.

---

### 3.2 Pydantic models — `backend/models.py`

Every API request and response body is a typed Pydantic `BaseModel`.

| Model | Direction | Fields |
|-------|-----------|--------|
| `SessionCreateRequest` | → backend | `username`, `time_class`, `n_games`, `threshold` |
| `SessionCreateResponse` | ← backend | `session_id`, `blunder_count`, `game_urls` |
| `BlunderResponse` | ← backend | `move_number`, `color`, `move_san`, `cp_loss`, `classification`, `fen_before`, `best_moves`, `prev_fen`, `prev_move_uci`, `eval_before_white_pov`, `game_url` |
| `AttemptRequest` | → backend | `session_id`, `uci_move` |
| `AttemptResponse` | ← backend | `was_correct`, `cp_loss`, `best_moves`, `uci_blunder`, `classification` |
| `SummaryResponse` | ← backend | `total_blunders`, `total_reviewed`, `correct`, `accuracy_pct`, `best_game_index`, `worst_game_index` |
| `EvaluateRequest` | → backend | `fen_before`, `uci_move` |
| `EvaluateResponse` | ← backend | `cp_loss`, `classification`, `eval_after_white_pov` |
| `AuthRequest` | → backend | `username`, `password` |
| `AuthResponse` | ← backend | `username` |
| `GameHistoryEntry` | ← backend | `url`, `date`, `result`, `white`, `black`, `time_class`, `blunder_count`, `was_reviewed` |

---

### 3.3 Routers

#### `routers/auth.py`

```
POST /api/auth/login     Body: AuthRequest  → AuthResponse
POST /api/auth/register  Body: AuthRequest  → AuthResponse
```

- Registration enforces `len(password) >= 5`.
- Delegates to `services/users.py`.

---

#### `routers/games.py`

```
GET /api/games
  ?username=str &time_class=str &n=int
  → list[Game]               (raw Chess.com game objects)

GET /api/games/history
  ?username=str &time_class=str &n=int &offset=int &threshold=int
  → list[GameHistoryEntry]   (enriched with cached blunder data)
```

The history endpoint joins each game URL against the analysis cache to populate `blunder_count` and `was_reviewed` without re-running Stockfish.

---

#### `routers/session.py` — Core training logic

```
GET  /api/session/build-stream   SSE stream → ProgressEvent, then done:SessionCreateResponse
POST /api/session/build          Sync build  → SessionCreateResponse
GET  /api/session/blunder        ?session_id → BlunderResponse   (404 when complete)
POST /api/session/attempt        Body: AttemptRequest → AttemptResponse
POST /api/session/skip           Body: {session_id}
GET  /api/session/summary        ?session_id → SummaryResponse
```

**In-memory session store:**
```python
SESSIONS: dict[str, dict] = {}
```
Sessions are stored per worker process and are lost on server restart. Each session dict holds:
```python
{
  "username":     str,
  "all_blunders": list[dict],  # Ordered list from all analysed games
  "index":        int,          # Current blunder pointer
  "attempts":     list[dict],  # Recorded user attempts
  "game_urls":    list[str],
}
```

**SSE build stream** (`GET /api/session/build-stream`):

The response is `text/event-stream`. Each event is JSON on a `data:` line:
```
data: {"type": "status",   "message": "Fetching games..."}
data: {"type": "progress", "pct": 25, "message": "Analysing game 1/4"}
data: {"type": "progress", "pct": 50, "message": "Analysing game 2/4"}
data: {"type": "done",     "session_id": "...", "blunder_count": 12, "game_urls": [...]}
data: {"type": "error",    "message": "..."}
```

The frontend opens an `EventSource` connection, updates the progress bar on each event, and redirects to the trainer on `done`.

---

#### `routers/analysis.py` — Stockfish evaluation

```
POST /api/analysis/evaluate          Body: EvaluateRequest   → EvaluateResponse
POST /api/analysis/respond           Body: {fen}             → {best_move_uci, eval_after}
GET  /api/analysis/best-moves        ?fen &n_best=5          → {best_moves: list[str]}
GET  /api/analysis/position          ?fen                    → {eval_white_pov: int}
GET  /api/analysis/blunder-line      ?fen &blunder_uci       → {moves: list[str]}
```

These endpoints wrap `services/stockfish.py` and are called live by the frontend during trainer interaction (eval bar updates, best-move arrows, bot responses, blunder sequence replay).

---

### 3.4 Services

#### `services/chess_com.py` — Chess.com Public API client

All requests include a `User-Agent` header (required by Chess.com's API policy).

```python
get_player_profile(username)              → profile dict
get_player_archives(username)             → list of archive URLs (newest first)
get_games_from_url(archive_url)           → list of raw game dicts
get_game_by_url(username, game_url)       → single game dict or None
get_recent_games_all(username, n)         → n most recent games (all time classes)
get_recent_games(username, time_class, n) → n most recent games of given time class
```

Archives are paged by month. `get_recent_games` walks archives newest-first and stops once `n` games are collected.

---

#### `services/stockfish.py` — Engine analysis

**Constants:**
```python
DEPTH         = 15          # Search depth for all evaluations
BEST_THRESHOLD = 10         # cp loss: "best"
GOOD_THRESHOLD = 30         # cp loss: "good"
INACCURACY     = 100        # cp loss: "inaccuracy"
MISTAKE        = 200        # cp loss: "mistake"
# > 200 = "blunder"
```

**Public functions:**

```python
analyze_game(pgn: str) → list[dict]
```
Plays through every move of a PGN, evaluates each with `MultiPV=2` at depth 15, and returns a list of move records:
```python
{
  "move_number": int,
  "color":       "white" | "black",
  "move_san":    str,
  "cp_loss":     int,   # centipawns lost vs. the best alternative
  "classification": "best"|"good"|"inaccuracy"|"mistake"|"blunder",
  "eval_before_white_pov": int,
}
```

```python
get_board_snapshots(pgn: str) → tuple[list[str], list[str]]
```
Returns `(fens, uci_moves)` — the FEN before each move and the move in UCI notation. Used to build the cached snapshot arrays.

```python
find_blunders(move_data: list[dict], min_cp_loss: int) → list[dict]
```
Filters `move_data` to moves where `cp_loss >= min_cp_loss`. Each returned dict is augmented with `move_index` (0-based index into the full move list).

```python
classify_move(cp_loss: int) → str
```
Maps a centipawn loss value to a classification label.

```python
evaluate_move_quality(fen_before: str, uci_move: str, depth: int)
  → tuple[int, str, int]   # (cp_loss, classification, eval_white_pov_after)
```
Opens Stockfish, runs `MultiPV=2` analysis, computes centipawn loss as `best_eval - played_eval` (always from the moving side's perspective), then converts to white POV.

```python
get_response_and_eval(fen: str, depth: int) → tuple[str, int]
```
Returns `(best_move_uci, eval_after_white_pov)` — Stockfish's top move and the resulting position evaluation.

```python
get_best_moves_for_fen(fen: str, n_best: int, depth: int) → list[str]
```
Returns up to `n_best` UCI moves from `MultiPV=n_best` analysis, keeping only moves classified as "best" or "good" (cp_loss ≤ `GOOD_THRESHOLD`).

```python
get_blunder_line(fen: str, blunder_uci: str, depth: int, n_moves: int) → list[str]
```
Returns `[blunder_uci, pv_move_1, pv_move_2, ...]` — the blunder followed by Stockfish's principal variation. Used for the "Show blunder sequence" animation.

```python
extract_clocks(pgn: str) → list[str]
```
Parses `%clk H:MM:SS` annotations from PGN comments.

---

#### `services/cache.py` — Disk-backed JSON cache

**Cache file:** `backend/cache/analysis_cache.json`  
**Cache key:** Chess.com game URL (unique per game)

Each entry:
```python
{
  "pgn":                     str,
  "move_data":               list[dict],   # Output of analyze_game()
  "fens":                    list[str],    # FEN before each move
  "uci_moves":               list[str],    # UCI move list
  "best_moves_per_blunder":  dict[str, list[str]],  # move_index str → UCIs
  "analysed_at":             str,          # UTC ISO datetime
  "depth":                   int,          # Stockfish depth used
}
```

**Functions:**
```python
load_cache()                                                         → dict
save_cache(cache)                                                    → None
is_cached(cache, game_url, depth)                                    → bool
get_cached_game(cache, game_url)                                     → dict
store_game(cache, game_url, pgn, move_data, fens, uci_moves,
           best_moves_per_blunder, depth)                            → None
get_cache_stats(cache)   → {total_games, total_size_kb, oldest_entry, newest_entry}
```

Cache paths are relative to the service file (`../cache/`) so they work regardless of working directory.

---

#### `services/trainer.py` — Session building and scoring

```python
build_session(username, time_class, games, threshold) → dict
```

For each game:
1. Check `is_cached(cache, game_url, depth)`.
2. **Cache hit:** Load move_data, fens, uci_moves, best_moves_per_blunder directly.
   - If cached at a higher threshold and user lowered it, compute missing best_moves on-demand and update cache.
3. **Cache miss:** Run `analyze_game(pgn)`, `get_board_snapshots(pgn)`, compute best_moves for every blunder, call `store_game()`.
4. Call `find_blunders(move_data, threshold)` to get the blunder list for this game.
5. Augment each blunder dict with: `fen_before`, `prev_fen`, `prev_move_uci`, `best_moves`, `eval_before_white_pov`, `game_url`.
6. Accumulate all blunders across games into `all_blunders`.

Returns a session dict that gets stored in `SESSIONS[session_id]`.

```python
get_current_blunder(session) → dict | None
```
Returns `session["all_blunders"][session["index"]]` or `None` when `index >= len(all_blunders)`.

```python
submit_attempt(session, uci_move) → dict
```
Checks if `uci_move` is in the current blunder's `best_moves` list.  
Appends an attempt record to `session["attempts"]`.  
Advances `session["index"]`.  
Returns `{was_correct, cp_loss, best_moves, uci_blunder, classification}`.

```python
get_summary(session) → dict
```
Aggregates `session["attempts"]` into accuracy stats and identifies best/worst game by attempt accuracy.

---

#### `services/users.py` — User authentication

**Storage:** `backend/users.json`  
Format: `{ "username_lowercase": { "username": str, "password": str, "created_at": str } }`

> **Warning:** Passwords are stored in plaintext. This is acceptable for a personal/local tool but must be replaced with bcrypt before any public deployment.

```python
load_users()              → dict
save_users(users)         → None
user_exists(username)     → bool
create_user(username, password)   # Raises ValueError if username taken
check_password(username, password) → bool
```

---

## 4. Frontend architecture

### 4.1 Entry point

`src/main.tsx` mounts `<App />` into `#root` inside `<StrictMode>`.

`src/App.tsx` reads `screen` from `useSession` and `isAuthenticated` from `useAuth` to decide which top-level component to render:

```
isAuthenticated == false  →  <Login />
screen == "setup"         →  <SessionSetup />
screen == "loading"       →  <Loading />
screen == "trainer"       →  <Trainer />
```

`<ErrorBanner />` and a theme toggle button are always mounted at the root level regardless of screen.

---

### 4.2 API client — `src/api/client.ts`

A typed, error-aware wrapper around the native `fetch` API.

**`ApiError`** — thrown on any non-2xx response:
```typescript
class ApiError extends Error {
  status: number
  message: string
}
```

**`fetchJson<T>(url, options?)`** — base function. Throws `ApiError` on failure, returns parsed JSON typed as `T`.

All public functions call `fetchJson` with the right types:

```typescript
// Auth
loginUser(username, password)   → Promise<AuthResponse>
registerUser(username, password) → Promise<AuthResponse>

// Games
getGames(username, timeClass, n) → Promise<Game[]>
fetchGameHistory(username, timeClass, n, offset, threshold) → Promise<GameHistoryEntry[]>

// Session
buildSession(req)                          → Promise<SessionCreateResponse>
streamBuildSession(req, onProgress)        → Promise<SessionCreateResponse>
getBlunder(sessionId)                      → Promise<BlunderResponse | undefined>
submitAttempt(req)                         → Promise<AttemptResponse>
skipBlunder(sessionId)                     → Promise<void>
getSummary(sessionId)                      → Promise<SummaryResponse>

// Analysis
evaluateMove(req)                          → Promise<EvaluateResponse>
getPositionEval(fen)                       → Promise<{ eval_white_pov: number }>
getBestMoves(fen, nBest)                   → Promise<{ best_moves: string[] }>
getStockfishMove(req)                      → Promise<RespondResponse>
getBlunderLine(fen, blunderUci)            → Promise<{ moves: string[] }>
```

`streamBuildSession` uses `EventSource` internally, calls `onProgress(event)` on each SSE message, and resolves the promise on the `done` event.

---

### 4.3 Zustand stores (hooks)

All stores use `zustand/middleware/persist` for localStorage persistence. Per-user namespacing is done by prefixing the storage key with the username.

---

#### `hooks/useAuth.ts`

```typescript
interface AuthState {
  username:    string | undefined
  isGuest:     boolean
  login(username: string):  void   // persist, reload namespaced stores
  loginAsGuest():           void   // isGuest=true, namespace="guest"
  logout():                 void   // clear auth
  getNamespace(): string           // returns username ?? "guest"
}
```

Persisted key: `recall_auth` → `{ username, isGuest }`

On `login()` / `loginAsGuest()`, the store calls `reloadForUser(namespace)` on `useSettings`, `useFavorites`, and `useReviewed` to load the correct per-user data.

---

#### `hooks/useSession.ts`

```typescript
interface SessionState {
  sessionId:       string | undefined
  currentBlunder:  BlunderResponse | undefined
  screen:          "login" | "setup" | "loading" | "trainer"
  loadingPct:      number
  loadingStatus:   string
  error:           string | undefined
  blunderCount:    number
  reviewedCount:   number

  buildSession(req: SessionCreateRequest): Promise<void>
  fetchBlunder():                          Promise<void>
  submitAttempt(uciMove: string):          Promise<AttemptResponse>
  skipBlunder():                           Promise<void>
  loadFavoritePosition(pos: FavoritePosition): void
  clearError():                            void
  reset():                                 void
}
```

**Not persisted** — ephemeral in-memory state.

`buildSession`:
1. Sets `screen = "loading"`, starts `streamBuildSession`.
2. Calls `onProgress` to update `loadingPct` and `loadingStatus`.
3. On completion: stores `sessionId`, `blunderCount`, calls `fetchBlunder()`, sets `screen = "trainer"`.

`fetchBlunder`:
- Calls `getBlunder(sessionId)`.
- If 404: marks current `game_urls` as reviewed via `useReviewed`, resets to setup, shows summary.
- Otherwise: sets `currentBlunder`.

`submitAttempt`:
- Calls `submitAttempt` on the client, increments `reviewedCount`, then `fetchBlunder()`.

---

#### `hooks/useSettings.ts`

```typescript
interface SettingsState {
  darkMode:  boolean    // default: true
  nGames:    number     // default: 1
  threshold: number     // default: 300 (cp)

  setDarkMode(v: boolean):  void
  setNGames(v: number):     void
  setThreshold(v: number):  void
  reloadForUser(ns: string): void
}
```

Persisted key: `recall_settings_{namespace}`.  
Falls back to legacy key `recall_settings` on first load for backwards compatibility.

The `threshold` setting controls the minimum centipawn loss that qualifies as a blunder for training. Default 300 cp is intentionally strict; lowering it shows more mistakes.

---

#### `hooks/useFavorites.ts`

```typescript
interface FavoritePosition {
  id:                   string   // "fav-{Date.now()}-{random}"
  date:                 string   // ISO timestamp
  fen:                  string
  orientation:          "white" | "black"
  blunderDescription:   string
  classification:       string
  cpLoss:               number
  moveSan:              string
  color:                string   // "w" | "b"
  moveNumber:           number
  boardImageDataUrl:    string   // Canvas PNG (data URL)
}

interface FavoritesState {
  favorites:             FavoritePosition[]
  addFavorite(pos):      void
  removeFavorite(id):    void
  isFavorited(fen):      boolean
  reloadForUser(ns):     void
}
```

Persisted key: `recall_favorites_{namespace}`.

The `boardImageDataUrl` is generated at save time by `utils/generateBoardImage.ts` so the thumbnail is visible without a board library or network call.

---

#### `hooks/useReviewed.ts`

```typescript
interface ReviewedState {
  reviewedUrls:         Set<string>
  namespace:            string

  markReviewed(urls: string[]): void
  isReviewed(url: string):      boolean
  reloadForUser(ns: string):    void
}
```

Persisted key: `recall_reviewed_{namespace}` → `string[]` (JSON array, converted to `Set` in memory).

Used by `SessionSetup` to show a "reviewed" indicator on games and by the "Smart" session builder to auto-skip already-reviewed games.

---

#### `hooks/useChessCom.ts`

Non-persisted hook that wraps `getGames()` from the API client. Used in `SessionSetup` to display the game history panel for a typed username.

---

### 4.4 Components

#### `Login/Login.tsx`

Two modes toggled by a tab: `"login"` | `"register"`.

**Login:** Calls `loginUser(username, password)`, then `useAuth.login(username)`.  
**Register:** Validates username non-empty, password ≥ 5 chars, passwords match. Calls `registerUser`, then `useAuth.login`.  
**Guest:** Calls `useAuth.loginAsGuest()`.

Errors from the API are displayed inline below the form.

---

#### `SessionSetup/SessionSetup.tsx`

Main menu screen after login. Two tabs: **Train** and **Favorites**.

**Train tab:**
- Username input field with a dropdown of recently used usernames (persisted to localStorage).
- Time class selector: `all | rapid | blitz | bullet | daily`.
- `nGames` and `threshold` sliders (synced to `useSettings`).
- Game history panel (renders `<GameHistory />`).
- **"Start Training"** button: calls `useSession.buildSession({ username, time_class, n_games, threshold })`.
- **"Smart" mode:** Scans the game history panel, picks the first non-reviewed game, builds a single-game session.

**Favorites tab:** Renders `<Favorites />`. Clicking a saved position calls `useSession.loadFavoritePosition(pos)`, which sets `currentBlunder` from a saved `FavoritePosition` and sets `screen = "trainer"` without building a backend session.

---

#### `Loading/Loading.tsx`

Displays while `screen == "loading"`.

Shows:
- A progress bar filled to `loadingPct %`.
- A status string (`loadingStatus`).
- A cancel button that calls `useSession.reset()`.

---

#### `Trainer/Trainer.tsx` — Main interactive screen

The most complex component. Manages:

**Local state:**
```typescript
localFen:        string     // Board FEN updated as user plays moves
moveLog:         MoveLogEntry[]  // Moves played + their evaluations
evalCache:       Record<string, EvaluateResponse>  // Avoid re-evaluating same move
firstMove:       string | undefined  // The first UCI move played (what gets submitted)
showBestMoves:   boolean    // Toggle best-move arrows overlay
botMode:         boolean    // Stockfish auto-responds to user moves
isPlayingSequence: boolean  // Blunder + PV auto-play animation in progress
```

**On blunder change** (when `currentBlunder` updates):
- Resets all local state above.
- Loads `currentBlunder.fen_before` as `localFen`.
- Sets up move log with the blunder's `prev_move_uci`.
- Fetches best moves if `showBestMoves` is enabled.

**Move handling (`handleMove(uci)`):**
1. Play the move on `localFen` → update `localFen`.
2. Add entry to `moveLog`.
3. Async: call `evaluateMove(fen_before, uci)` → populate cp_loss + classification in the log entry.
4. If `botMode` is on and it's Stockfish's turn: call `getStockfishMove(localFen)`, play the response.
5. If no `firstMove` yet: set `firstMove = uci`.

**Submit ("Next" button):**
- Calls `useSession.submitAttempt(firstMove)`.
- The response includes `was_correct` — displayed briefly before advancing.

**"Show blunder sequence" button:**
1. Calls `getBlunderLine(fen_before, uci_blunder)` → `[blunder_uci, pv_1, pv_2, ...]`.
2. Animates each move with a 600ms delay between steps.
3. Sets `isPlayingSequence = true` during playback, disables board interaction.

**Save position:**
1. Calls `generateBoardImage(localFen, orientation)` → data URL.
2. Calls `useFavorites.addFavorite({ fen: localFen, boardImageDataUrl, ... })`.

**Eval bar:** Receives `currentBlunder.eval_before_white_pov`. Updated live as user plays moves (async `getPositionEval` after each move in `moveLog`).

---

#### `Board/Board.tsx`

Thin wrapper around `react-chessboard`'s `Chessboard` component.

**Props:**
```typescript
fen:          string
orientation:  "white" | "black"
onMove:       (uci: string) => void
arrowUcis?:   string[]    // Best-move arrows (shown when showBestMoves is on)
lastMoveUci?: string      // Highlighted last move
```

Shows an intro overlay on the first render of a new blunder — displays the opponent's move that led to the blunder position (`prev_fen` → `prev_move_uci`) before the user takes control.

---

#### `EvalBar/EvalBar.tsx`

Vertical bar representing the evaluation from white's POV.

- Positive centipawns → white segment grows upward.
- Negative → black segment grows.
- Clamps display at ±500 cp (±5 pawns) to avoid extreme visuals.
- Color: white segment is white, black segment is dark.

---

#### `BlunderCard/BlunderCard.tsx`

Card overlay showing context about the current blunder:
- Move number and color (e.g., "Black's move 23")
- SAN notation of the blunder move
- Classification badge (color-coded by severity)
- Centipawn loss
- "Show blunder sequence" button

---

#### `MoveLog/MoveLog.tsx`

Scrollable table of moves the user has played in the current position. Each row shows:
- SAN move
- Classification badge
- Centipawn loss

Populates asynchronously as evaluations come in from the analysis endpoint.

---

#### `Reveal/Reveal.tsx`

Brief feedback screen shown after `submitAttempt` returns, before advancing to the next blunder:
- Correct / incorrect indicator
- The best move(s) that should have been played
- The cp_loss of the move that was submitted

---

#### `Summary/Summary.tsx`

End-of-session results displayed after `fetchBlunder` returns 404:
- Accuracy percentage (correct / total)
- Best and worst game (by individual game accuracy)
- Links to the Chess.com game pages for review
- "Play again" button

---

#### `Favorites/Favorites.tsx`

Grid of saved `FavoritePosition` cards (from `useFavorites`):
- Board thumbnail (the stored `boardImageDataUrl`)
- Description: move number, color, classification, SAN, cp_loss
- Delete button
- Click on card: `useSession.loadFavoritePosition(pos)`

---

#### `GameHistory/GameHistory.tsx`

Paginated table of recent games for the entered username.

Columns: Date, Result (W/L/D), White player, Black player, Time class, Blunder count, Reviewed status.

Buttons:
- "Train this game" — builds a single-game session directly from this row.
- "Load more" — fetches the next page (`offset += n`).

Reviewed games show a checkmark indicator (from `useReviewed`).

---

#### `PlayerBanner/PlayerBanner.tsx`

Displays Chess.com profile info for a username: avatar, username, title, ratings.

#### `ErrorBanner/ErrorBanner.tsx`

Fixed-position banner at the top of the screen. Reads `error` from `useSession` and shows it when non-null. Has a dismiss button that calls `clearError()`.

---

### 4.5 Utilities

#### `utils/sounds.ts`

```typescript
playMoveSound(): void
```

Plays a short click sound on each chess move for tactile feedback.

---

#### `utils/generateBoardImage.ts`

```typescript
generateBoardImage(fen: string, orientation: "white" | "black"): Promise<string>
```

Draws a chess position onto an off-screen `<canvas>` using colored squares and Unicode piece symbols. Returns a PNG data URL. No external dependencies. Used to generate the thumbnail stored in `FavoritePosition.boardImageDataUrl`.

---

## 5. End-to-end data flows

### 5.1 Authentication

```
User opens app
  → screen: "login"
  → Login form submitted
  → POST /api/auth/login or /api/auth/register
  → AuthResponse { username }
  → useAuth.login(username)
      → persist to localStorage
      → reload useSettings, useFavorites, useReviewed for this user's namespace
  → screen: "setup"
```

---

### 5.2 Building a training session

```
SessionSetup: user fills form (username, time_class, nGames, threshold)
  → click "Start Training"
  → useSession.buildSession({ username, time_class, n_games, threshold })
      → screen = "loading"
      → streamBuildSession() opens EventSource to GET /api/session/build-stream

Backend (session.py build-stream handler):
  → services/chess_com.get_recent_games(username, time_class, n_games)
  → yield {"type":"status", "message":"Fetching games..."}
  For each game:
    → yield {"type":"progress", "pct":..., "message":"Analysing game X/Y"}
    → load cache or run Stockfish analysis (60–90s per game on cache miss)
    → store_game() if cache miss
  → yield {"type":"done", "session_id":"...", "blunder_count":N, "game_urls":[...]}

Frontend:
  → loadingPct updates on each progress event
  → on "done": sessionId stored, fetchBlunder() called
      → GET /api/session/blunder?session_id=...  → BlunderResponse
  → screen = "trainer"
```

---

### 5.3 Training loop

```
Trainer mounts with currentBlunder:
  → localFen = blunder.fen_before
  → Board shows position; best-move arrows loaded (if enabled)
  → Eval bar shows blunder.eval_before_white_pov

User drags a piece → handleMove(uci):
  → localFen updated
  → moveLog entry added (pending eval)
  → Async: POST /api/analysis/evaluate → cp_loss, classification → update log entry
  → If botMode: POST /api/analysis/respond → Stockfish plays response
  → firstMove = uci (if first move)

User clicks "Next":
  → POST /api/session/attempt { session_id, uci_move: firstMove }
  → Backend: was_correct = (firstMove in blunder.best_moves)
  → reviewedCount++
  → fetchBlunder() → next blunder or 404

On 404 (all blunders done):
  → useReviewed.markReviewed(game_urls)
  → GET /api/session/summary → SummaryResponse
  → screen = "setup", summary shown
```

---

### 5.4 Favorites flow

```
Trainer: user clicks "Save position"
  → generateBoardImage(localFen, orientation) → dataUrl
  → useFavorites.addFavorite({
      fen: localFen, boardImageDataUrl: dataUrl,
      classification, cpLoss, moveSan, ...
    })
  → Persisted to localStorage under recall_favorites_{namespace}

SessionSetup → Favorites tab:
  → <Favorites /> renders saved positions as cards with thumbnails
  → User clicks a card
  → useSession.loadFavoritePosition(pos)
      → currentBlunder built from FavoritePosition data
      → screen = "trainer"  (no backend session)
  → Trainer opens in analysis mode (no submit / skip)
```

---

## 6. Caching strategy

Stockfish analysis is the project's main bottleneck (~60–90 seconds per game at depth 15). The disk cache eliminates re-analysis:

**Cache key:** Chess.com game URL (globally unique per game)  
**Cache file:** `backend/cache/analysis_cache.json`  
**Invalidation rule:** Entry is stale if its stored `depth != DEPTH`. Any depth change triggers full re-analysis.

**Cache hit scenario** (typical repeated use):
```
build-stream received → is_cached(url, depth=15) == True
  → load move_data, fens, uci_moves, best_moves_per_blunder instantly
  → session built in < 1 second per game
```

**Smart threshold lowering:**
If a user changes `threshold` from 300 to 200 cp, some blunders in the cache might be missing `best_moves` (because they weren't blunders at the old threshold). `trainer.py` detects this case, computes missing best_moves on-demand for those blunder positions, and updates the cache entry.

---

## 7. Move classification system

Centipawn loss is measured from the moving side's perspective (not white's). This ensures that both players' moves are classified symmetrically.

| CP loss | Classification |
|---------|---------------|
| 0 – 10  | best |
| 11 – 30 | good |
| 31 – 100 | inaccuracy |
| 101 – 200 | mistake |
| > 200 | blunder |

The training `threshold` (default 300 cp) is intentionally higher than the "blunder" cutoff of 200 cp to filter to the most egregious mistakes for focused training. Lowering the threshold to 200 includes all blunders; going below that starts including mistakes.

---

## 8. State persistence (localStorage)

| Key | Store | Contents |
|-----|-------|----------|
| `recall_auth` | `useAuth` | `{ username, isGuest }` |
| `recall_settings_{ns}` | `useSettings` | `{ darkMode, nGames, threshold }` |
| `recall_favorites_{ns}` | `useFavorites` | `FavoritePosition[]` |
| `recall_reviewed_{ns}` | `useReviewed` | `string[]` (game URLs) |

`{ns}` is the lowercase username or `"guest"`.

On `useAuth.login(username)`, each store's `reloadForUser(namespace)` is called, which re-reads localStorage under the new key and resets the in-memory state.

---

## 9. Coding standards

Defined in `CLAUDE.local.md`. Key rules:

**TypeScript / React:**
- Always type `useState`, `useRef`, and function parameters explicitly.
- Prefer `undefined` over `null` as the "no value" sentinel.
- Prefer `??` (nullish coalescing) over `||` (logical OR).
- No inline if-else (always use multi-line `if/else` blocks).
- No inline return statements — return on its own line.
- Always inline function call arguments: `fn(a, b, c)` not multi-line arg lists.
- Unique keys in iteration: `elementName-${id}-${index}`.
- All code must be modular and follow separation of concerns.

**Comments:**
- Always comment code — provide clear explanations of logic and purpose.

---

## 10. Known limitations and TODOs

### Security
- **Plaintext passwords** in `users.json` — replace with `bcrypt` + a proper DB.
- **No API authentication** — all endpoints are publicly accessible on the local network. Add JWT bearer tokens before any networked deployment.
- **CORS `allow_origins=["*"]`** — must be restricted to the frontend origin in production.

### Architecture
- **In-memory session store** (`SESSIONS` dict in `session.py`) — sessions are lost on server restart. Replace with Redis or a persistent store for multi-process / production use.
- **Single Uvicorn worker** — Stockfish analysis blocks the event loop. Move long-running analysis to a `ProcessPoolExecutor` or a background task queue (e.g., Celery) to avoid request timeouts under concurrent users.
- **No multi-user isolation** — session IDs are random UUIDs so they don't collide, but there is no per-user access control on session endpoints.

### Features
- **Fixed analysis depth** — Stockfish depth is hardcoded at 15. Exposing it as a setting would let users trade speed for accuracy.
- **No opening book** — early game moves are evaluated by Stockfish even though they are well-known theory; a book filter would reduce noise.
- **No daily/960 support** — Chess.com variants and daily games may parse incorrectly; only standard rapid/blitz/bullet are tested.
