"""Blunder categorisation — assigns each blunder a single type label.

Material categories are derived from the engine's principal variation (the
forced sequence) so multi-move tactics are tagged correctly — a one-ply static
check would miss a piece won/lost several moves deep. Mate categories are
eval-based (mate-in-N is already encoded in the evaluation). A pure eval-only
fallback (categorize_from_eval) exists for legacy cached games that have no
stored category yet.

Category keys are kept in sync with the frontend constants
(frontend/src/constants/blunderCategories.ts).
"""

import chess
import chess.engine

from services.stockfish import STOCKFISH_PATH

# ── Category keys ────────────────────────────────────────────────────────────
ALLOWED_MATE: str = "allowed_mate"
MISSED_MATE: str = "missed_mate"
MATERIAL_LOSS: str = "material_loss"
MISSED_GAIN: str = "missed_gain"
POSITIONAL: str = "positional"
# Used only for legacy blunders whose material category cannot be recovered from eval.
UNCATEGORIZED: str = "uncategorized"

# Eval magnitude (cp) above which a position is treated as a forced mate.
# The engine reports mate near the ±10000 _MATE_SCORE sentinel, so anything
# beyond ~50 pawns is effectively a forced sequence.
MATE_EVAL_THRESHOLD: int = 5000

# Search depth for the principal-variation lines used in material detection.
CATEGORIZE_DEPTH: int = 12

# Max plies to follow a principal variation. The line is extended past the cap
# while the next move is still a capture (quiescence) so a swing that is
# mid-exchange at the cap is not truncated.
_PV_PLY_CAP: int = 4

# Net material swing (in pawns) that counts as a real material gain/loss.
_MATERIAL_DELTA: int = 1

# Standard piece values in pawns (king omitted — it is never captured).
_PIECE_VALUES: dict[int, int] = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
}


def _material_balance(board: chess.Board, color: chess.Color) -> int:
    """Return color's material advantage (own material minus opponent's), in pawns."""
    own: int = 0
    opp: int = 0

    for piece_type, value in _PIECE_VALUES.items():
        own += value * len(board.pieces(piece_type, color))
        opp += value * len(board.pieces(piece_type, not color))

    return own - opp


def _resolve_line_balance(
    engine: chess.engine.SimpleEngine,
    fen_before: str,
    first_uci: str,
    mover_color: chess.Color,
) -> int | None:
    """Play first_uci then follow the engine PV to a quiescent point.

    Returns the mover's material balance at the end of the line, or None if the
    first move is illegal for the position.

    Args:
        engine: An open engine session (reused across both lines for one blunder).
        fen_before: FEN of the position before the blunder move.
        first_uci: The move that starts the line (the played move or the best move).
        mover_color: The side whose material balance is measured (the blunderer).
    """
    board = chess.Board(fen_before)

    try:
        board.push(chess.Move.from_uci(first_uci))
    except (ValueError, AssertionError):
        return None

    if not board.is_game_over():
        info = engine.analyse(board, chess.engine.Limit(depth=CATEGORIZE_DEPTH))
        pv: list[chess.Move] = info.get("pv", [])

        plies: int = 0
        for move in pv:
            # Stop once past the ply cap, but only at a quiescent move (no capture).
            if plies >= _PV_PLY_CAP and not board.is_capture(move):
                break
            board.push(move)
            plies += 1

    return _material_balance(board, mover_color)


def derive_mover_evals(move_data: list[dict], move_index: int) -> tuple[int, int | None]:
    """Return (eval_before_mover, eval_after_mover) in cp for a move_data index.

    Mirrors the perspective conversion find_blunders() performs: the stored
    eval_before_white_pov of this move and of the next move, flipped to the
    mover's point of view. eval_after is None when there is no following move.

    Args:
        move_data: Output of analyze_game().
        move_index: 0-based index of the move within move_data.
    """
    move: dict = move_data[move_index]
    color: str = move.get("color", "")
    eval_white_before: int = move.get("eval_before_white_pov", 0)

    eval_white_after: int | None = None
    if move_index + 1 < len(move_data):
        eval_white_after = move_data[move_index + 1].get("eval_before_white_pov")

    if color == "white":
        eval_before_mover: int = eval_white_before
        eval_after_mover: int | None = eval_white_after
    else:
        eval_before_mover = -eval_white_before
        eval_after_mover = -eval_white_after if eval_white_after is not None else None

    return eval_before_mover, eval_after_mover


def resolve_category(
    move_data: list[dict],
    fens: list[str],
    uci_moves: list[str],
    move_index: int,
    best_moves: list[str],
) -> str:
    """Compute the category for one blunder from cached game data.

    Convenience wrapper used by the build paths and the per-game analyse path so
    they all derive evals and inputs the same way.

    Args:
        move_data: Output of analyze_game().
        fens: FEN snapshots (fens[move_index] is the position before the move).
        uci_moves: UCI move list (uci_moves[move_index] is the played move).
        move_index: Index of the blunder move.
        best_moves: Engine best moves at this position (best_moves[0] is the top).
    """
    eval_before_mover, eval_after_mover = derive_mover_evals(move_data, move_index)
    fen_before: str = fens[move_index]
    uci_played: str = uci_moves[move_index]

    if best_moves:
        best_move_uci: str | None = best_moves[0]
    else:
        best_move_uci = None

    return categorize_blunder(fen_before, uci_played, eval_before_mover, eval_after_mover, best_move_uci)


def categorize_from_eval(eval_before_mover: int, eval_after_mover: int | None) -> str | None:
    """Return a mate category from evals alone, or None if neither mate case applies.

    Used both as the first (free) step of full categorisation and as the legacy
    fallback for cached games that predate stored categories.

    Args:
        eval_before_mover: Eval before the move, from the mover's perspective (cp).
        eval_after_mover: Eval after the move, from the mover's perspective (cp);
            None when it cannot be derived (e.g. last move of the game).
    """
    # Allowing the opponent a forced mate is the most severe outcome.
    if eval_after_mover is not None and eval_after_mover <= -MATE_EVAL_THRESHOLD:
        return ALLOWED_MATE

    # Had a forced mate and lost it (no longer forcing mate after the move).
    if eval_before_mover >= MATE_EVAL_THRESHOLD:
        if eval_after_mover is None or eval_after_mover < MATE_EVAL_THRESHOLD:
            return MISSED_MATE

    return None


def categorize_blunder(
    fen_before: str,
    uci_played: str,
    eval_before_mover: int,
    eval_after_mover: int | None,
    best_move_uci: str | None,
) -> str:
    """Assign a single category to a blunder.

    Priority: allowed_mate > missed_mate > material_loss > missed_gain > positional.
    Mate cases are eval-based (free). Material cases play out the forced line with
    one engine session shared between the played-move and best-move lines.

    Args:
        fen_before: FEN of the position before the blunder move.
        uci_played: UCI of the move actually played.
        eval_before_mover: Eval before the move from the mover's perspective (cp).
        eval_after_mover: Eval after the move from the mover's perspective (cp), or None.
        best_move_uci: Engine's best move at fen_before (for missed-gain detection),
            or None when unavailable.

    Returns:
        One of the category key constants.
    """
    # Step 1 — mate categories from evals (no engine needed).
    mate_category: str | None = categorize_from_eval(eval_before_mover, eval_after_mover)

    if mate_category is not None:
        return mate_category

    # Step 2 — material categories from the forced lines (one engine session).
    board = chess.Board(fen_before)
    mover_color: chess.Color = board.turn
    baseline: int = _material_balance(board, mover_color)

    engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)

    try:
        played_end: int | None = _resolve_line_balance(engine, fen_before, uci_played, mover_color)

        if best_move_uci is not None:
            best_end: int | None = _resolve_line_balance(engine, fen_before, best_move_uci, mover_color)
        else:
            best_end = None

    finally:
        engine.quit()

    # The played move's forced line ends with the mover down material.
    if played_end is not None and played_end <= baseline - _MATERIAL_DELTA:
        return MATERIAL_LOSS

    # A material-winning line existed and the played move did not realise it.
    if best_end is not None and played_end is not None:
        if best_end >= baseline + _MATERIAL_DELTA and played_end < best_end:
            return MISSED_GAIN

    # Step 3 — eval dropped but material is essentially unchanged either way.
    return POSITIONAL
