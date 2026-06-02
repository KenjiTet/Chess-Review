/**
 * Typed API client for the Recall FastAPI backend.
 * All functions throw ApiError on non-2xx responses.
 * Optional backend fields typed as string | null (what JSON actually delivers).
 */

// Empty base — /api/* calls are proxied to the backend by Vite (dev) or the host (prod).
const BASE_URL = '';

// ── Types ──────────────────────────────────────────────────────────────────

export interface AuthResponse {
  success: boolean;
  username: string;
  message: string;
}

export interface GameHistoryEntry {
  url: string;
  date: string;
  result: 'win' | 'lose' | 'draw';
  time_class: string;
  white_username: string;
  black_username: string;
  white_accuracy: number | null;
  black_accuracy: number | null;
  blunder_count: number | null;
  first_blunder_fen: string | null;
  first_blunder_color: string | null;
}

export interface SessionCreateRequest {
  username: string;
  time_class: string;
  n_games: number;
  threshold: number;
  game_url?: string;
}

export interface SessionCreateResponse {
  session_id: string;
  blunder_count: number;
  game_urls: string[];
}

export interface BlunderResponse {
  move_number: number;
  color: string;
  move_san: string;
  cp_loss: number;
  classification: string;
  fen_before: string;
  /** null when the blunder is the very first move of the game */
  prev_fen: string | null;
  /** null when the blunder is the very first move of the game */
  prev_move_uci: string | null;
  best_moves: string[];
  uci_played: string;
  eval_before_white_pov: number;
  /** Index of the blunder move within game_fens / game_uci_moves */
  move_index?: number;
  /** All FENs for the entire game (len == game_uci_moves.length + 1) */
  game_fens?: string[];
  /** UCI moves for the entire game */
  game_uci_moves?: string[];
  white_username?: string;
  white_rating?: number;
  black_username?: string;
  black_rating?: number;
  time_remaining_white?: string | null;
  time_remaining_black?: string | null;
}

export interface AttemptRequest {
  session_id: string;
  uci_move: string;
}

export interface AttemptResponse {
  correct: boolean;
  cp_loss: number;
  classification: string;
  best_moves: string[];
  uci_blunder: string;
}

export interface EvaluateRequest {
  fen_before: string;
  uci_move: string;
  depth?: number;
}

export interface EvaluateResponse {
  cp_loss: number;
  classification: string;
  eval_after_white_pov: number;
}

export interface Game {
  url: string;
  pgn: string;
  time_class: string;
  white: { username: string; rating: number };
  black: { username: string; rating: number };
}

/** Incremental status event emitted by the /build-stream SSE endpoint. */
export interface ProgressEvent {
  status: string;
  pct: number;
  session_id?: string;
  blunder_count?: number;
  game_urls?: string[];
  error?: string;
}

// ── Error class ────────────────────────────────────────────────────────────

/** Thrown by all API functions on non-2xx HTTP responses. */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

// ── Internal ───────────────────────────────────────────────────────────────

/** Fetch JSON from the API; throw ApiError on non-2xx. */
async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);

  if (!response.ok) {
    const body: { detail?: string } = await response.json().catch(() => ({ detail: response.statusText }));
    throw new ApiError(response.status, body.detail ?? response.statusText);
  }

  return response.json() as Promise<T>;
}

// ── Auth ───────────────────────────────────────────────────────────────────

/** Attempt to log in with username and password. */
export function loginUser(username: string, password: string): Promise<AuthResponse> {
  return fetchJson<AuthResponse>(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

/** Register a new account with username and password. */
export function registerUser(username: string, password: string): Promise<AuthResponse> {
  return fetchJson<AuthResponse>(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

// ── Games ──────────────────────────────────────────────────────────────────

/** Fetch the n most recent games for a player and time class. */
export function getGames(username: string, timeClass: string, n: number): Promise<Game[]> {
  const params = new URLSearchParams({ username, time_class: timeClass, n: String(n) });
  return fetchJson<Game[]>(`${BASE_URL}/api/games?${params}`);
}

/** Fetch enriched game history with blunder data from cache. Guest sessions skip cache. */
export function fetchGameHistory(
  username: string,
  timeClass: string,
  n: number,
  offset: number,
  threshold: number,
  isGuest: boolean = false,
): Promise<GameHistoryEntry[]> {
  const params = new URLSearchParams({
    username,
    time_class: timeClass,
    n: String(n),
    offset: String(offset),
    threshold: String(threshold),
    is_guest: String(isGuest),
  });
  return fetchJson<GameHistoryEntry[]>(`${BASE_URL}/api/games/history?${params}`);
}


// ── Session ────────────────────────────────────────────────────────────────

/**
 * Build a session via SSE stream.
 * Calls onProgress with each status event so the UI can render a live progress bar.
 * Resolves with session_id, blunder_count and game_urls when the stream signals "done".
 * Rejects with ApiError on server error or connection failure.
 */
export function streamBuildSession(
  req: SessionCreateRequest,
  onProgress: (event: ProgressEvent) => void,
): Promise<SessionCreateResponse> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      username: req.username,
      time_class: req.time_class,
      n_games: String(req.n_games),
      threshold: String(req.threshold),
    });

    if (req.game_url) {
      params.set('game_url', req.game_url);
    }

    const source = new EventSource(`${BASE_URL}/api/session/build-stream?${params}`);

    source.onmessage = (e: MessageEvent<string>) => {
      const data = JSON.parse(e.data) as ProgressEvent;
      onProgress(data);

      if (data.status === 'done') {
        source.close();
        resolve({
          session_id: data.session_id ?? '',
          blunder_count: data.blunder_count ?? 0,
          game_urls: data.game_urls ?? [],
        });
      } else if (data.status === 'error') {
        source.close();
        reject(new ApiError(500, data.error ?? 'Unknown server error'));
      }
    };

    source.onerror = () => {
      source.close();
      reject(new ApiError(500, 'Lost connection to server during session build.'));
    };
  });
}

/**
 * Return the current blunder for a session.
 * Returns undefined when the session is complete (backend returns 404).
 */
export async function getBlunder(sessionId: string): Promise<BlunderResponse | undefined> {
  try {
    return await fetchJson<BlunderResponse>(`${BASE_URL}/api/session/blunder?session_id=${sessionId}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return undefined;
    }
    throw err;
  }
}

/** Submit a move attempt and receive correctness feedback. */
export function submitAttempt(req: AttemptRequest): Promise<AttemptResponse> {
  return fetchJson<AttemptResponse>(`${BASE_URL}/api/session/attempt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
}


/** Skip the current blunder without submitting an attempt. */
export async function skipBlunder(sessionId: string): Promise<void> {
  await fetchJson<{ skipped: boolean }>(`${BASE_URL}/api/session/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

// ── Analysis ───────────────────────────────────────────────────────────────

/** Evaluate a single move quality via Stockfish. */
export function evaluateMove(req: EvaluateRequest): Promise<EvaluateResponse> {
  return fetchJson<EvaluateResponse>(`${BASE_URL}/api/analysis/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export interface RespondRequest {
  fen: string;
  depth?: number;
}

export interface RespondResponse {
  best_move_uci: string | null;
  eval_after_white_pov: number;
}

/** Evaluate a position (no move) — returns white-POV centipawn score. */
export function getPositionEval(fen: string): Promise<{ eval_white_pov: number }> {
  const params = new URLSearchParams({ fen });
  return fetchJson<{ eval_white_pov: number }>(`${BASE_URL}/api/analysis/position?${params}`);
}

/** Return the top best moves for a given FEN position (for arrow display). */
export function getBestMoves(fen: string, nBest: number = 5): Promise<{ best_moves: string[] }> {
  const params = new URLSearchParams({ fen, n_best: String(nBest) });
  return fetchJson<{ best_moves: string[] }>(`${BASE_URL}/api/analysis/best-moves?${params}`);
}

/** Ask Stockfish for its best response move in bot mode. */
export function getStockfishMove(req: RespondRequest): Promise<RespondResponse> {
  return fetchJson<RespondResponse>(`${BASE_URL}/api/analysis/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export interface BlunderLineResponse {
  moves: string[];
}

/** Return the blunder move + Stockfish's PV continuation as a UCI move list. */
export function getBlunderLine(fen: string, blunderUci: string): Promise<BlunderLineResponse> {
  const params = new URLSearchParams({ fen, blunder_uci: blunderUci });
  return fetchJson<BlunderLineResponse>(`${BASE_URL}/api/analysis/blunder-line?${params}`);
}
