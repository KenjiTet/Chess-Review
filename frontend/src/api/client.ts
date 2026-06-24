/**
 * Typed API client for the Recall FastAPI backend.
 * All functions throw ApiError on non-2xx responses.
 * Optional backend fields typed as string | null (what JSON actually delivers).
 */

// Empty base — /api/* calls are proxied to the backend by Vite (dev) or the host (prod).
// Empty string = same-origin (works in both local dev via Vite proxy and production via FastAPI static serving).
// Set VITE_API_BASE_URL if the backend is ever split onto a separate domain.
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

// ── Types ──────────────────────────────────────────────────────────────────

export interface AuthResponse {
  success: boolean;
  username: string;
  message: string;
  token?: string;
  is_admin?: boolean;
  avatar?: string;
  /** Linked platform handles — tell the client whose games to fetch. */
  chesscom_username?: string | null;
  lichess_username?: string | null;
}

export interface GameHistoryEntry {
  url: string;
  date: string;
  result: 'win' | 'lose' | 'draw';
  time_class: string;
  white_username: string;
  white_rating: number | null;
  black_username: string;
  black_rating: number | null;
  white_accuracy: number | null;
  black_accuracy: number | null;
  blunder_count: number | null;
  first_blunder_fen: string | null;
  first_blunder_color: string | null;
  /** Count of the player's blunders per category, e.g. { material_loss: 2 }. */
  blunder_categories: Record<string, number>;
  /** Blunders bucketed by game phase, then category, e.g. { opening: { material_loss: 1 } }. */
  blunder_phases?: Record<string, Record<string, number>>;
}

export interface SessionCreateRequest {
  username: string;
  time_class: string;
  n_games: number;
  threshold: number;
  game_url?: string;
  platform?: string;
  /** Blunder categories to train on. Empty/omitted means all categories. */
  categories?: string[];
  /** Game phase to train on ("opening"/"middlegame"/"endgame"). Omitted means all phases. */
  phase?: string;
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
  /** Blunder type key (see constants/blunderCategories.ts). */
  category: string;
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

/**
 * Token provider — injected at runtime to avoid a circular dependency between
 * the API client module and the Zustand auth store.
 */
let _getToken: (() => string | undefined) | undefined;

/** Register the auth store's token getter so the client can attach JWT headers. */
export function setTokenProvider(getter: () => string | undefined): void {
  _getToken = getter;
}

/** Fetch JSON from the API; throw ApiError on non-2xx.
 *  Automatically attaches Authorization: Bearer <token> when a token is available.
 */
async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const token = _getToken?.();
  const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const mergedOptions: RequestInit = {
    ...options,
    headers: {
      ...authHeader,
      ...(options?.headers as Record<string, string> | undefined),
    },
  };

  const response = await fetch(url, mergedOptions);

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

/** Register a new account, linking one Chess.com / Lichess handle. Returns a JWT (auto-login). */
export function registerUser(username: string, password: string, platform: string, platformUsername: string): Promise<AuthResponse> {
  return fetchJson<AuthResponse>(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, platform, platform_username: platformUsername }),
  });
}

/** Link (or change) a platform handle on the authenticated account. */
export function linkAccount(platform: string, platformUsername: string): Promise<AuthResponse> {
  return fetchJson<AuthResponse>(`${BASE_URL}/api/auth/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform, platform_username: platformUsername }),
  });
}

/** Passwordless identification — validate username exists on platform and receive a JWT. */
export function identifyUser(username: string, platform: string): Promise<AuthResponse> {
  return fetchJson<AuthResponse>(`${BASE_URL}/api/auth/identify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, platform }),
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
  platform: string = 'chesscom',
): Promise<GameHistoryEntry[]> {
  const params = new URLSearchParams({
    username,
    time_class: timeClass,
    n: String(n),
    offset: String(offset),
    threshold: String(threshold),
    is_guest: String(isGuest),
    platform,
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
      platform: req.platform ?? 'chesscom',
    });

    if (req.game_url) {
      params.set('game_url', req.game_url);
    }

    // Repeat the categories param once per selected type (FastAPI list query param).
    if (req.categories) {
      req.categories.forEach((category) => params.append('categories', category));
    }

    if (req.phase) {
      params.set('phase', req.phase);
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

/** Mark a list of game URLs as reviewed for the authenticated user. */
export function markGamesReviewed(gameUrls: string[]): Promise<{ marked: number }> {
  return fetchJson<{ marked: number }>(`${BASE_URL}/api/session/mark-reviewed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gameUrls),
  });
}

/** Fetch all game URLs the authenticated user has previously reviewed. */
export function fetchReviewedGames(): Promise<{ game_urls: string[] }> {
  return fetchJson<{ game_urls: string[] }>(`${BASE_URL}/api/session/reviewed-games`);
}

/** Record how many blunder positions were drilled in a session (server derives per-game counts). */
export function recordSessionProgress(sessionId: string): Promise<{ recorded: number }> {
  return fetchJson<{ recorded: number }>(`${BASE_URL}/api/session/record-progress`, {
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

// ── User profile ───────────────────────────────────────────────────────────

export interface UserProfileResponse {
  joined_year: number | null;
  rapid_rating: number | null;
  blitz_rating: number | null;
  bullet_rating: number | null;
  avatar: string | null;
}

export interface GameAnalysisResult {
  blunder_count: number;
  first_blunder_fen: string | null;
  first_blunder_color: string | null;
  white_accuracy: number | null;
  black_accuracy: number | null;
  /** Count of the player's blunders per category, e.g. { material_loss: 2 }. */
  blunder_categories: Record<string, number>;
  /** Blunders bucketed by game phase, then category, e.g. { opening: { material_loss: 1 } }. */
  blunder_phases?: Record<string, Record<string, number>>;
}

/** Fetch a player's public profile and ratings. */
export function fetchUserProfile(username: string, platform: string = 'chesscom'): Promise<UserProfileResponse> {
  const params = new URLSearchParams({ username, platform });
  return fetchJson<UserProfileResponse>(`${BASE_URL}/api/user/profile?${params}`);
}

/** Analyse a single game with Stockfish and return its blunder count (reads from cache on hit). */
export function fetchGameAnalysis(
  gameUrl: string,
  username: string,
  threshold: number,
  isGuest: boolean = false,
  platform: string = 'chesscom',
): Promise<GameAnalysisResult> {
  const params = new URLSearchParams({
    game_url: gameUrl,
    username,
    threshold: String(threshold),
    is_guest: String(isGuest),
    platform,
  });
  return fetchJson<GameAnalysisResult>(`${BASE_URL}/api/games/analyze?${params}`);
}

// ── User stats ───────────────────────────────────────────────────────────────

export interface UserStats {
  games_analysed: number;
  avg_blunders: number | null;
  blunders_drilled: number;
}

/** Fetch DB-derived training stats for the authenticated user, filtered by time class,
 *  the active blunder-severity threshold (avg blunders is recomputed for it), and the
 *  active linked handle (so stats are scoped to the current platform account). */
export function fetchUserStats(timeClass: string, threshold: number, handle: string): Promise<UserStats> {
  const params = new URLSearchParams({ time_class: timeClass, threshold: String(threshold), handle });
  return fetchJson<UserStats>(`${BASE_URL}/api/user/stats?${params}`);
}

// ── Full user stats dashboard ────────────────────────────────────────────────

export interface RatingRecord {
  current: number | null;
  peak: number | null;
  peak_date: number | null;
  wins: number;
  losses: number;
  draws: number;
}

export interface AccountStats {
  joined_year: number | null;
  avatar: string | null;
  country: string | null;
  followers: number | null;
  league: string | null;
  name: string | null;
  title: string | null;
  /** Per-time-class ratings + records keyed by "rapid"/"blitz"/"bullet"/"daily". */
  ratings: Record<string, RatingRecord>;
  total_games: number;
  overall_win_rate: number | null;
}

export interface TrainingStats {
  games_analysed: number;
  games_analysed_by_class: Record<string, number>;
  total_blunders: number;
  avg_blunders: number | null;
  avg_blunders_by_class: Record<string, number>;
  wins: number;
  draws: number;
  losses: number;
  win_rate: number | null;
  clean_games: number;
  most_blunders_in_game: number;
  /** Analysed-games trend keyed by month (YYYY-MM). */
  analysed_by_month: Record<string, number>;
}

export interface EngagementStats {
  games_reviewed: number;
  positions_drilled: number;
  review_coverage: number | null;
  drill_rate: number | null;
  current_review_streak: number;
  longest_review_streak: number;
}

export interface UserFullStats {
  account: AccountStats;
  training: TrainingStats;
  engagement: EngagementStats;
  /** Count of the player's own blunders per category key. */
  blunder_types: Record<string, number>;
  phases: Record<string, number>;
  colors: Record<string, number>;
  severity: Record<string, number>;
  avg_cp_loss: number | null;
}

/** Fetch the full stats dashboard for the authenticated account + linked handle. */
export function fetchUserStatsFull(handle: string, platform: string = 'chesscom'): Promise<UserFullStats> {
  const params = new URLSearchParams({ handle, platform });
  return fetchJson<UserFullStats>(`${BASE_URL}/api/user/stats/full?${params}`);
}

export interface UserAnalysisStatus {
  /** Current queue phase: "idle" | "backfill" | "poll". */
  mode: string;
  /** Game URLs the background queue is analysing right now. */
  analysing: string[];
  /** Game URLs queued for analysis but not yet started. */
  pending: string[];
}

/** Fetch the background queue's live analysis state for the authenticated user. */
export function fetchUserAnalysisStatus(): Promise<UserAnalysisStatus> {
  return fetchJson<UserAnalysisStatus>(`${BASE_URL}/api/user/analysis-status`);
}

// ── Admin ──────────────────────────────────────────────────────────────────

export interface AdminUser {
  username: string;
  username_lower: string;
  created_at: string;
  is_admin: boolean;
}

export interface AdminCacheEntry {
  url: string;
  analysed_at: string;
  depth: number;
}

export interface AdminStats {
  total_users: number;
  total_cached_games: number;
  total_analysed_games: number;
}

export interface AdminUserStat {
  username_lower: string;
  username: string;
  games_analysed: number;
  total_blunders: number;
  avg_blunders: number;
  wins: number;
  draws: number;
  losses: number;
  blunders_drilled: number;
}

export interface AdminQueueStatus {
  enabled: boolean;
  running: boolean;
  mode: string;
  concurrency: number;
  backfill_target: number;
  poll_interval: number;
  analysed_total: number;
  in_flight: string[];
  pending_by_stream: Record<string, number>;
}

/** Fetch all registered users from the DB (admin only). */
export function adminGetUsers(): Promise<AdminUser[]> {
  return fetchJson<AdminUser[]>(`${BASE_URL}/api/admin/users`);
}

/** Fetch recent cached game analysis entries (admin only). */
export function adminGetCache(limit: number = 50): Promise<AdminCacheEntry[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  return fetchJson<AdminCacheEntry[]>(`${BASE_URL}/api/admin/cache?${params}`);
}

/** Fetch aggregate DB stats (admin only). */
export function adminGetStats(): Promise<AdminStats> {
  return fetchJson<AdminStats>(`${BASE_URL}/api/admin/stats`);
}

/** Fetch per-user aggregate training stats (admin only). */
export function adminGetUserStats(): Promise<AdminUserStat[]> {
  return fetchJson<AdminUserStat[]>(`${BASE_URL}/api/admin/user-stats`);
}

/** Fetch the background analysis queue's live status (admin only). */
export function adminGetQueueStatus(): Promise<AdminQueueStatus> {
  return fetchJson<AdminQueueStatus>(`${BASE_URL}/api/admin/queue-status`);
}

// ── Admin DB browser ─────────────────────────────────────────────────────────

/** A cell value as delivered by SQLite over JSON. */
export type DbCellValue = string | number | boolean | null;

export interface DbTableSummary {
  name: string;
  row_count: number;
  columns: string[];
}

/** PRAGMA table_info row describing one column. */
export interface DbColumn {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: DbCellValue;
  pk: number;
}

export interface DbTablePage {
  table: string;
  columns: DbColumn[];
  /** Identity columns used to address a row (the primary key, or ["rowid"]). */
  primary_key: string[];
  rows: Record<string, DbCellValue>[];
  total: number;
}

/** List every table with row counts and column names (admin only). */
export function adminDbTables(): Promise<DbTableSummary[]> {
  return fetchJson<DbTableSummary[]>(`${BASE_URL}/api/admin/db/tables`);
}

/** Fetch one page of rows + column metadata for a table (admin only). */
export function adminDbTable(table: string, limit: number = 100, offset: number = 0): Promise<DbTablePage> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return fetchJson<DbTablePage>(`${BASE_URL}/api/admin/db/table/${encodeURIComponent(table)}?${params}`);
}

/** Update one row addressed by its primary-key values (admin only). */
export function adminDbUpdateRow(table: string, key: Record<string, DbCellValue>, updates: Record<string, DbCellValue>): Promise<{ affected: number }> {
  return fetchJson<{ affected: number }>(`${BASE_URL}/api/admin/db/table/${encodeURIComponent(table)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, updates }),
  });
}

/** Insert a new row from a column -> value map (admin only). */
export function adminDbInsertRow(table: string, values: Record<string, DbCellValue>): Promise<{ inserted: number }> {
  return fetchJson<{ inserted: number }>(`${BASE_URL}/api/admin/db/table/${encodeURIComponent(table)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
}

/** Delete one row addressed by its primary-key values (admin only). */
export function adminDbDeleteRow(table: string, key: Record<string, DbCellValue>): Promise<{ affected: number }> {
  return fetchJson<{ affected: number }>(`${BASE_URL}/api/admin/db/table/${encodeURIComponent(table)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
}
