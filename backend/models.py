"""Pydantic request/response models for the Recall FastAPI backend."""

from typing import Any

from pydantic import BaseModel


class SessionCreateRequest(BaseModel):
    """Request body for building a new training session."""
    username: str
    time_class: str
    n_games: int
    threshold: int
    platform: str = "chesscom"
    # Blunder categories to train on. Empty/None means all categories.
    categories: list[str] | None = None


class SessionCreateResponse(BaseModel):
    """Response after a session is successfully built."""
    session_id: str
    blunder_count: int
    game_urls: list[str] = []


class BlunderResponse(BaseModel):
    """A single blunder position in the training session."""
    move_number: int
    color: str
    move_san: str
    cp_loss: int
    classification: str
    # Blunder type (missed_mate / allowed_mate / material_loss / missed_gain / positional).
    category: str = "positional"
    fen_before: str
    prev_fen: str | None = None
    prev_move_uci: str | None = None
    best_moves: list[str]
    uci_played: str
    eval_before_white_pov: int = 0
    # Index of the blunder move within game_fens / game_uci_moves.
    move_index: int = 0
    # Full position list for the entire game.
    # game_fens[i] is the position before move i; game_uci_moves[i] is that move.
    # len(game_fens) == len(game_uci_moves) + 1
    game_fens: list[str] = []
    game_uci_moves: list[str] = []
    white_username: str = ""
    white_rating: int = 0
    black_username: str = ""
    black_rating: int = 0
    time_remaining_white: str | None = None
    time_remaining_black: str | None = None


class AttemptRequest(BaseModel):
    """User's move attempt for the current blunder."""
    session_id: str
    uci_move: str


class AttemptResponse(BaseModel):
    """Feedback after the user submits a move attempt."""
    correct: bool
    cp_loss: int
    classification: str
    best_moves: list[str]
    uci_blunder: str


class SummaryResponse(BaseModel):
    """End-of-session performance summary."""
    total_blunders: int
    total_reviewed: int
    correct: int
    accuracy_pct: float
    best_game_url: str | None = None
    worst_game_url: str | None = None


class SkipRequest(BaseModel):
    """Request to skip the current blunder without recording an attempt."""
    session_id: str


class RecordProgressRequest(BaseModel):
    """Request to record how many blunder positions the user drilled in a session."""
    session_id: str


class EvaluateRequest(BaseModel):
    """Request body for evaluating a single move quality."""
    fen_before: str
    uci_move: str
    depth: int = 10


class EvaluateResponse(BaseModel):
    """Evaluation result for a single move."""
    cp_loss: int
    classification: str
    eval_after_white_pov: int


class RespondRequest(BaseModel):
    """Request body for getting Stockfish's best response move for a FEN."""
    fen: str
    depth: int = 10


class RespondResponse(BaseModel):
    """Stockfish's response move and the resulting evaluation."""
    best_move_uci: str | None
    eval_after_white_pov: int


class AuthRequest(BaseModel):
    """Request body for login or registration."""
    username: str
    password: str


class IdentifyRequest(BaseModel):
    """Request body for passwordless identification — username + platform only."""
    username: str
    platform: str  # "chesscom" | "lichess"


class RegisterRequest(BaseModel):
    """Request body for creating an account linked to one platform handle.

    The account username is the login identity; platform_username is the
    Chess.com / Lichess handle whose games the account will train on.
    """
    username: str
    password: str
    platform: str  # "chesscom" | "lichess"
    platform_username: str


class LinkAccountRequest(BaseModel):
    """Request body for linking (or changing) a platform handle on an account."""
    platform: str  # "chesscom" | "lichess"
    platform_username: str


class AuthResponse(BaseModel):
    """Response for login, registration, or identification."""
    success: bool
    username: str
    message: str
    # JWT — present on login, absent on registration (user must log in after registering).
    token: str | None = None
    is_admin: bool = False
    avatar: str | None = None
    # Linked platform handles — tell the client whose games to fetch.
    chesscom_username: str | None = None
    lichess_username: str | None = None


class GameHistoryEntry(BaseModel):
    """A single game entry in the player's game history panel."""
    url: str
    date: str
    result: str
    time_class: str
    white_username: str
    white_rating: int | None = None
    black_username: str
    black_rating: int | None = None
    white_accuracy: float | None = None
    black_accuracy: float | None = None
    blunder_count: int | None = None
    first_blunder_fen: str | None = None
    first_blunder_color: str | None = None
    # Count of the player's blunders per category, e.g. {"material_loss": 2}.
    blunder_categories: dict[str, int] = {}
    # Count of the player's blunders per game phase then category, e.g.
    # {"opening": {"material_loss": 1}, "endgame": {"missed_gain": 2}}.
    blunder_phases: dict[str, dict[str, int]] = {}


class UserProfileResponse(BaseModel):
    """Public profile and ratings for a Chess.com / Lichess player."""
    joined_year: int | None = None
    rapid_rating: int | None = None
    blitz_rating: int | None = None
    bullet_rating: int | None = None
    avatar: str | None = None


class UserStatsResponse(BaseModel):
    """DB-derived training stats for the authenticated account."""
    games_analysed: int = 0
    # Average blunders per game for the selected time class (None when no games analysed).
    avg_blunders: float | None = None
    # Total blunder positions actually drilled, across all time classes.
    blunders_drilled: int = 0


class RatingRecord(BaseModel):
    """Per-time-class rating snapshot and W/L/D record from the platform API."""
    current: int | None = None
    peak: int | None = None
    peak_date: int | None = None
    wins: int = 0
    losses: int = 0
    draws: int = 0


class AccountStats(BaseModel):
    """Section A — platform profile / ratings, covering all played games."""
    joined_year: int | None = None
    avatar: str | None = None
    country: str | None = None
    followers: int | None = None
    league: str | None = None
    name: str | None = None
    title: str | None = None
    # Per-time-class ratings + records, keyed by "rapid"/"blitz"/"bullet"/"daily".
    ratings: dict[str, RatingRecord] = {}
    # Total rated games and overall win rate across all classes (from records).
    total_games: int = 0
    overall_win_rate: float | None = None


class TrainingStats(BaseModel):
    """Section B — training activity derived from analysed games."""
    games_analysed: int = 0
    games_analysed_by_class: dict[str, int] = {}
    total_blunders: int = 0
    avg_blunders: float | None = None
    avg_blunders_by_class: dict[str, float] = {}
    wins: int = 0
    draws: int = 0
    losses: int = 0
    win_rate: float | None = None
    clean_games: int = 0
    most_blunders_in_game: int = 0
    # Analysed-games trend keyed by month (YYYY-MM).
    analysed_by_month: dict[str, int] = {}


class EngagementStats(BaseModel):
    """Section C — review / drill engagement."""
    games_reviewed: int = 0
    positions_drilled: int = 0
    review_coverage: float | None = None
    drill_rate: float | None = None
    current_review_streak: int = 0
    longest_review_streak: int = 0


class UserFullStatsResponse(BaseModel):
    """Full user-stats dashboard payload (sections A–E of the catalogue)."""
    account: AccountStats = AccountStats()
    training: TrainingStats = TrainingStats()
    engagement: EngagementStats = EngagementStats()
    # Section D — count of the player's own blunders per category key.
    blunder_types: dict[str, int] = {}
    # Section E — move-level breakdowns.
    phases: dict[str, int] = {}
    colors: dict[str, int] = {}
    severity: dict[str, int] = {}
    avg_cp_loss: float | None = None


class UserAnalysisStatusResponse(BaseModel):
    """Live background-queue analysis state for the authenticated account."""
    # Current queue phase: "idle" | "backfill" | "poll".
    mode: str = "idle"
    # Game URLs the queue is analysing right now (show a spinner on these).
    analysing: list[str] = []
    # Game URLs queued for analysis but not yet started.
    pending: list[str] = []


class GameAnalysisResult(BaseModel):
    """Blunder data returned by the per-game analyze endpoint."""
    blunder_count: int
    first_blunder_fen: str | None = None
    first_blunder_color: str | None = None
    # Per-player accuracy so the history row can update without a full reload.
    white_accuracy: float | None = None
    black_accuracy: float | None = None
    # Count of the player's blunders per category, e.g. {"material_loss": 2}.
    blunder_categories: dict[str, int] = {}
    # Count of the player's blunders per game phase then category.
    blunder_phases: dict[str, dict[str, int]] = {}


class AdminRowUpdateRequest(BaseModel):
    """Admin DB browser — update one row addressed by its primary-key values."""
    # Map of identity column -> original value identifying the row to update.
    key: dict[str, Any]
    # Map of column -> new value to write.
    updates: dict[str, Any]


class AdminRowInsertRequest(BaseModel):
    """Admin DB browser — insert a new row from a column -> value map."""
    values: dict[str, Any]


class AdminRowDeleteRequest(BaseModel):
    """Admin DB browser — delete one row addressed by its primary-key values."""
    key: dict[str, Any]
