"""Pydantic request/response models for the Recall FastAPI backend."""

from pydantic import BaseModel


class SessionCreateRequest(BaseModel):
    """Request body for building a new training session."""
    username: str
    time_class: str
    n_games: int
    threshold: int
    platform: str = "chesscom"


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


class AuthResponse(BaseModel):
    """Response for login or registration."""
    success: bool
    username: str
    message: str
    # JWT — present on login, absent on registration (user must log in after registering).
    token: str | None = None
    is_admin: bool = False
    avatar: str | None = None


class GameHistoryEntry(BaseModel):
    """A single game entry in the player's game history panel."""
    url: str
    date: str
    result: str
    time_class: str
    white_username: str
    black_username: str
    white_accuracy: float | None = None
    black_accuracy: float | None = None
    blunder_count: int | None = None
    first_blunder_fen: str | None = None
    first_blunder_color: str | None = None


class GameAnalysisResult(BaseModel):
    """Blunder data returned by the per-game analyze endpoint."""
    blunder_count: int
    first_blunder_fen: str | None = None
    first_blunder_color: str | None = None
