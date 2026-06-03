"""Stockfish-based chess move analysis utilities — port of chess-trainer/analysis.py.

STOCKFISH_PATH is read from the STOCKFISH_PATH environment variable (set via .env).
"""

import asyncio
import io
import os
import re
import sys

import chess
import chess.engine
import chess.pgn
from dotenv import load_dotenv

# Load .env from the backend root so STOCKFISH_PATH is available at import time
load_dotenv()

# On Windows, python-chess spawns Stockfish via asyncio subprocesses.
# SelectorEventLoop (the default) does not support subprocess_exec — ProactorEventLoop does.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

STOCKFISH_PATH: str = os.environ.get("STOCKFISH_PATH", "")
DEPTH: int = 15
# Endgame detection: use a deeper search when few pieces remain on the board.
ENDGAME_DEPTH: int = 20
ENDGAME_PIECE_THRESHOLD: int = 8

# Centipawn-loss upper bounds per classification label.
# Losses exceeding the "mistake" bound are classified as blunders.
THRESHOLDS: dict[str, int] = {
    "best": 10,
    "good": 30,
    "inaccuracy": 100,
    "mistake": 200,
}

# Sentinel value passed to score() so mate sequences return a finite centipawn value.
_MATE_SCORE: int = 10_000


def classify_move(cp_loss: int) -> str:
    """Map a centipawn loss to a quality label.

    Args:
        cp_loss: Centipawn loss for the move (0 = perfect, higher = worse).

    Returns:
        One of: best / good / inaccuracy / mistake / blunder.
    """
    if cp_loss <= THRESHOLDS["best"]:
        return "best"
    if cp_loss <= THRESHOLDS["good"]:
        return "good"
    if cp_loss <= THRESHOLDS["inaccuracy"]:
        return "inaccuracy"
    if cp_loss <= THRESHOLDS["mistake"]:
        return "mistake"
    return "blunder"


def _depth_for_board(board: chess.Board) -> int:
    """Return ENDGAME_DEPTH when few pieces remain, DEPTH otherwise."""
    if len(board.piece_map()) <= ENDGAME_PIECE_THRESHOLD:
        return ENDGAME_DEPTH
    return DEPTH


def compute_player_accuracy(move_data: list[dict]) -> dict[str, float]:
    """Compute per-player accuracy from Stockfish move data using a win-probability model.

    Three filters are applied before scoring each move:
      1. Losing position filter: moves where the mover is already clearly losing
         (eval_mover < ACCURACY_MIN_EVAL) are excluded. Win% is already near 0%
         so any move scores near-perfect — those inflated scores don't reflect skill.
      2. Mate-score filter: positions flagged with a forced-mate eval
         (|eval| > ACCURACY_MATE_THRESHOLD) are excluded. The same compression
         issue applies at the top of the win% curve.
      3. Calibration: the raw average is passed through a linear transform fitted
         empirically against Chess.com CAPS2 scores on 10 games. This corrects the
         remaining ~5–10% systematic overestimation from the formula itself.

    Args:
        move_data: Output of analyze_game() — list of move dicts with cp_loss,
                   color, and eval_before_white_pov.

    Returns:
        Dict {"white": float, "black": float} with accuracy percentages [0, 100].
        Sides with no scoreable moves are omitted from the dict.
    """
    import math

    # Moves below this eval (from the mover's POV) are excluded — position is
    # already lost and any move scores near 100% regardless of quality.
    ACCURACY_MIN_EVAL: int = -300

    # Positions with |eval| above this are forced-mate sequences — same inflation
    # problem at the top of the win% curve.
    ACCURACY_MATE_THRESHOLD: int = 2000

    # Linear calibration coefficients fitted against Chess.com CAPS2 on 10 games
    # after applying the losing-position and mate-score filters above.
    #   calibrated = CALIB_A * raw_avg + CALIB_B
    # Fit: post-filter raw [50.0–77.4] → Chess.com [53.9–89.7], MAE ≈ 4.77%.
    CALIB_A: float = 0.8380
    CALIB_B: float = 13.6227

    def win_pct(cp: int) -> float:
        """Win probability (%) for a centipawn score from the mover's perspective."""
        return 100.0 / (1.0 + 10.0 ** (-cp / 400.0))

    white_accs: list[float] = []
    black_accs: list[float] = []

    for move in move_data:
        cp_loss: int = move.get("cp_loss", 0)
        color: str = move.get("color", "")
        eval_white: int = move.get("eval_before_white_pov", 0)

        # Convert eval to the mover's perspective.
        if color == "white":
            eval_mover: int = eval_white
        else:
            eval_mover = -eval_white

        # Step 1 — skip losing positions (eval already hopeless).
        if eval_mover < ACCURACY_MIN_EVAL:
            continue

        # Step 2 — skip mate-score positions (win% pinned at 100%).
        if abs(eval_white) > ACCURACY_MATE_THRESHOLD:
            continue

        wp_before: float = win_pct(eval_mover)
        wp_after: float = win_pct(eval_mover - cp_loss)
        wp_loss: float = max(0.0, wp_before - wp_after)

        acc: float = max(0.0, min(100.0, 103.1668 * math.exp(-0.04354 * wp_loss) - 3.1668))

        if color == "white":
            white_accs.append(acc)
        elif color == "black":
            black_accs.append(acc)

    result: dict[str, float] = {}

    # Step 3 — apply linear calibration to bring raw average in line with CAPS2.
    if white_accs:
        raw: float = sum(white_accs) / len(white_accs)
        result["white"] = max(0.0, min(100.0, CALIB_A * raw + CALIB_B))

    if black_accs:
        raw = sum(black_accs) / len(black_accs)
        result["black"] = max(0.0, min(100.0, CALIB_A * raw + CALIB_B))

    return result


def analyze_game(pgn: str) -> list[dict]:
    """Analyse every move in a PGN string with Stockfish.

    Evaluates the position before and after each move to compute centipawn loss
    from the mover's perspective. Engine is always closed via try/finally.

    Args:
        pgn: Full PGN string of the game.

    Returns:
        List of dicts (one per move), each containing:
            move_number    : int  — full move number (1-based)
            color          : str  — "white" or "black"
            move_san       : str  — move in Standard Algebraic Notation
            cp_loss        : int  — centipawn loss (0 = perfect)
            classification : str  — best / good / inaccuracy / mistake / blunder

    Raises:
        ValueError: If the PGN cannot be parsed.
    """
    game = chess.pgn.read_game(io.StringIO(pgn))

    if game is None:
        raise ValueError("Could not parse PGN string — check that it is valid.")

    results: list[dict] = []
    engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)

    try:
        board = game.board()

        for node in game.mainline():
            move = node.move
            color: str = "white" if board.turn == chess.WHITE else "black"
            move_number: int = board.fullmove_number
            move_san: str = board.san(move)

            # Evaluate position BEFORE the move from the mover's perspective.
            info_before = engine.analyse(board, chess.engine.Limit(depth=_depth_for_board(board)))
            score_before: int = info_before["score"].relative.score(mate_score=_MATE_SCORE)
            eval_before_white: int = info_before["score"].white().score(mate_score=_MATE_SCORE)

            # Record the engine's top choice to guard against eval variance on the best move.
            pv_before = info_before.get("pv")
            best_move_uci: str | None = pv_before[0].uci() if pv_before else None

            board.push(move)

            # After the move, board.turn has flipped to the opponent.
            # .relative is now from the opponent's POV, so negate to stay with the mover.
            info_after = engine.analyse(board, chess.engine.Limit(depth=_depth_for_board(board)))
            score_after: int = -info_after["score"].relative.score(mate_score=_MATE_SCORE)

            # If the game move was the engine's best, cp_loss is always 0 regardless of
            # eval variance between the two independent engine calls.
            if move.uci() == best_move_uci:
                cp_loss: int = 0
            else:
                cp_loss = max(0, score_before - score_after)

            results.append({
                "move_number": move_number,
                "color": color,
                "move_san": move_san,
                "cp_loss": cp_loss,
                "classification": classify_move(cp_loss),
                "eval_before_white_pov": eval_before_white,
            })

    finally:
        engine.quit()

    return results


def get_board_snapshots(pgn: str) -> tuple[list[str], list[str]]:
    """Parse a PGN and return FEN snapshots and UCI moves for every position.

    Args:
        pgn: Full PGN string of the game.

    Returns:
        Tuple (fens, moves) where:
            fens[0]  = starting position FEN
            fens[i]  = FEN after the i-th move
            moves[i] = UCI string of the i-th move (e.g. "e2e4")
            len(fens) == len(moves) + 1

    Raises:
        ValueError: If the PGN cannot be parsed.
    """
    game = chess.pgn.read_game(io.StringIO(pgn))

    if game is None:
        raise ValueError("Could not parse PGN string — check that it is valid.")

    board = game.board()
    fens: list[str] = [board.fen()]
    moves: list[str] = []

    for node in game.mainline():
        moves.append(node.move.uci())
        board.push(node.move)
        fens.append(board.fen())

    return fens, moves


# Centipawn threshold above which a position is considered "clearly winning"
# for the mover. Suboptimal moves in already-winning positions that remain
# clearly winning after the move are suppressed (e.g. mate-in-4 played as
# mate-in-8 — still a winning position, not worth flagging as a blunder).
STILL_WINNING_CP: int = 300


def find_blunders(move_data: list[dict], min_cp_loss: int = 100) -> list[dict]:
    """Filter a move list to only moves that qualify as real blunders.

    A move is suppressed even if its centipawn loss exceeds min_cp_loss when
    the position is clearly winning both before and after the move (i.e. the
    player was winning and remains winning — the "suboptimal but fine" case).

    Args:
        move_data: Output of analyze_game().
        min_cp_loss: Minimum centipawn loss to qualify as a blunder (default 100).

    Returns:
        List of blunder dicts with an added "move_index" key (0-based index
        into the original move_data list).
    """
    result: list[dict] = []

    for i, move in enumerate(move_data):
        if move["cp_loss"] < min_cp_loss:
            continue

        color: str = move.get("color", "")
        eval_white_before: int = move.get("eval_before_white_pov", 0)

        # Derive eval-after from the next move's eval-before (already in move_data).
        eval_white_after: int | None = None
        if i + 1 < len(move_data):
            eval_white_after = move_data[i + 1].get("eval_before_white_pov")

        # Convert evals to the mover's perspective.
        if color == "white":
            eval_before_mover: int = eval_white_before
            eval_after_mover: int | None = eval_white_after
        else:
            eval_before_mover = -eval_white_before
            eval_after_mover = -eval_white_after if eval_white_after is not None else None

        # Suppress "still winning" moves: position was clearly winning before and
        # remains clearly winning after — the move was suboptimal but not a real error.
        if eval_after_mover is not None and eval_before_mover >= STILL_WINNING_CP and eval_after_mover >= STILL_WINNING_CP:
            continue

        # Copy the dict so the original is not mutated.
        blunder = dict(move)
        blunder["move_index"] = i
        result.append(blunder)

    return result


def get_response_and_eval(fen: str, depth: int = 10) -> tuple[str | None, int]:
    """Play Stockfish's best response move and return (sf_uci, eval_after_cp).

    Runs a single engine session: plays the response then evaluates the result.
    Returns (None, 0) if the position is already game-over.
    eval_after_cp is centipawns from white's POV.

    Args:
        fen: FEN string of the position where Stockfish should move.
        depth: Search depth for both the response move and post-move eval.

    Returns:
        Tuple (sf_move_uci, cp_after) where sf_move_uci is the move played
        (or None if game is over) and cp_after is the eval after that move.
    """
    board = chess.Board(fen)

    if board.is_game_over():
        return (None, 0)

    engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)

    try:
        result = engine.play(board, chess.engine.Limit(depth=depth))

        if result.move:
            sf_move: str | None = result.move.uci()
        else:
            sf_move = None

        if sf_move:
            board.push(result.move)

        if board.is_game_over():
            if board.result() == "1-0":
                score: int = _MATE_SCORE
            else:
                score = -_MATE_SCORE
            return (sf_move, score)

        info = engine.analyse(board, chess.engine.Limit(depth=depth))
        cp: int = info["score"].white().score(mate_score=_MATE_SCORE)
        return (sf_move, cp)

    finally:
        engine.quit()


def evaluate_move_quality(fen_before: str, uci_move: str, depth: int = 10) -> tuple[int, str, int]:
    """Evaluate the quality of a single move against Stockfish's assessment.

    Uses MultiPV to obtain consistent scores from a single analysis pass, then
    compares the played move to the engine's best move. This avoids the
    evaluation variance that arises when two independent engine calls are used
    (which can mis-classify the best move as an inaccuracy in losing positions).

    Args:
        fen_before: FEN of the position before the move.
        uci_move: UCI string of the move (e.g. "e2e4").
        depth: Stockfish search depth.

    Returns:
        Tuple (cp_loss, classification, eval_after_white_pov) where:
            cp_loss              — centipawns lost vs the best available move (0 = best)
            classification       — best / good / inaccuracy / mistake / blunder
            eval_after_white_pov — eval after the move from white's POV (for the eval bar)
    """
    board = chess.Board(fen_before)

    if board.is_game_over():
        return (0, "best", 0)

    engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)

    try:
        # MultiPV gives all candidate scores from one analysis, removing cross-call variance.
        infos = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=5)

        if isinstance(infos, dict):
            infos = [infos]

        best_score: int = 0
        best_move_uci: str | None = None
        user_move_score: int | None = None

        for info in infos:
            pv = info.get("pv")
            score_obj = info.get("score")
            if pv and score_obj:
                cp = score_obj.relative.score(mate_score=_MATE_SCORE)
                if cp is not None:
                    move_uci = pv[0].uci()
                    if best_move_uci is None:
                        best_score = cp
                        best_move_uci = move_uci
                    if move_uci == uci_move:
                        user_move_score = cp

        board.push(chess.Move.from_uci(uci_move))

        if board.is_game_over():
            if board.result() == "1-0":
                eval_white: int = _MATE_SCORE
            else:
                eval_white = -_MATE_SCORE
            return (0, "best", eval_white)

        info_after = engine.analyse(board, chess.engine.Limit(depth=depth))
        score_after_mover: int = -info_after["score"].relative.score(mate_score=_MATE_SCORE)
        eval_white = info_after["score"].white().score(mate_score=_MATE_SCORE)

        # The best move is always "best" — no threshold check, no variance risk.
        if uci_move == best_move_uci:
            return (0, "best", eval_white)

        # Use the MultiPV score when available (same-analysis comparison, no variance).
        # Fall back to comparing best_score vs actual result when move was outside top-5.
        if user_move_score is not None:
            cp_loss: int = max(0, best_score - user_move_score)
        else:
            cp_loss = max(0, best_score - score_after_mover)

        return (cp_loss, classify_move(cp_loss), eval_white)

    finally:
        engine.quit()


def evaluate_position(fen: str, depth: int = 10) -> int:
    """Return Stockfish evaluation from white's POV for the given position.

    Args:
        fen: FEN string of the position.
        depth: Stockfish search depth.

    Returns:
        Centipawn score from white's perspective (positive = white winning).
    """
    board = chess.Board(fen)

    if board.is_game_over():
        result = board.result()
        if result == "1-0":
            return _MATE_SCORE
        if result == "0-1":
            return -_MATE_SCORE
        return 0

    engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)

    try:
        info = engine.analyse(board, chess.engine.Limit(depth=depth))
        cp: int = info["score"].white().score(mate_score=_MATE_SCORE)
        return cp
    finally:
        engine.quit()


def get_best_moves_for_fen(fen: str, n_best: int = 5, depth: int = 10) -> list[str]:
    """Return up to n_best quality moves for the given FEN position.

    Runs a MultiPV analysis and filters to moves whose centipawn loss vs the
    best move is within the "good" threshold (≤ 25 cp). Moves are ordered best
    first. Returns an empty list if the position is game-over.

    Args:
        fen: FEN string of the position to analyse.
        n_best: Maximum number of moves to return (default 5).
        depth: Stockfish search depth.

    Returns:
        List of UCI strings for best/good moves only.
    """
    board = chess.Board(fen)

    if board.is_game_over():
        return []

    engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)

    try:
        infos = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=n_best)

        if isinstance(infos, dict):
            infos = [infos]

        moves_with_scores: list[tuple[str, int]] = []

        for info in infos:
            pv = info.get("pv")
            score_obj = info.get("score")
            if pv and score_obj:
                cp = score_obj.relative.score(mate_score=_MATE_SCORE)
                if cp is not None:
                    moves_with_scores.append((pv[0].uci(), cp))

        if not moves_with_scores:
            return []

        best_score: int = moves_with_scores[0][1]
        good_moves: list[str] = []

        for uci, cp in moves_with_scores:
            cp_loss: int = max(0, best_score - cp)
            if cp_loss <= THRESHOLDS["good"]:
                good_moves.append(uci)

        return good_moves

    finally:
        engine.quit()


def get_blunder_line(fen_before: str, blunder_uci: str, depth: int = 10, n_moves: int = 5) -> list[str]:
    """Return the blunder move followed by Stockfish's PV continuation.

    Pushes the blunder onto the board, runs engine.analyse() at the given depth,
    then extracts up to n_moves moves from the principal variation.

    Args:
        fen_before:  FEN of the position before the blunder.
        blunder_uci: UCI string of the blunder move (e.g. "e5d3").
        depth:       Stockfish search depth.
        n_moves:     Maximum number of continuation moves after the blunder.

    Returns:
        [blunder_uci, pv_move_1, pv_move_2, ...] — up to n_moves + 1 entries.
    """
    board = chess.Board(fen_before)
    board.push(chess.Move.from_uci(blunder_uci))

    if board.is_game_over():
        return [blunder_uci]

    engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)

    try:
        info = engine.analyse(board, chess.engine.Limit(depth=depth))
        pv = info.get("pv", [])
        continuation = [move.uci() for move in pv[:n_moves]]
        return [blunder_uci] + continuation
    finally:
        engine.quit()


def extract_clocks(pgn: str) -> list[str]:
    """Extract clock times from PGN clock annotations in half-move order.

    Parses [%clk H:MM:SS] annotations embedded in move comments.
    Index i corresponds to the clock remaining after the i-th half-move.

    Args:
        pgn: Full PGN string of the game.

    Returns:
        List of "H:MM:SS" time strings, one per annotated half-move.
        Empty list when the PGN has no clock annotations.
    """
    return re.findall(r'\[%clk\s+(\d+:\d{2}:\d{2})\]', pgn)


def get_best_moves(pgn: str, move_index: int, n_best: int = 3) -> list[str]:
    """Ask Stockfish for the top n moves at the position BEFORE move_index.

    Replays the PGN up to (but not including) move_index to reach the target
    position, then runs a MultiPV analysis. Engine is always closed via try/finally.

    Args:
        pgn: Full PGN string of the game.
        move_index: 0-based index of the blunder move in the game's move list.
        n_best: Number of top moves to return (default 3).

    Returns:
        List of UCI strings for the top n_best moves, e.g. ["e2e4", "d2d4"].
    """
    game = chess.pgn.read_game(io.StringIO(pgn))

    if game is None:
        raise ValueError("Could not parse PGN string — check that it is valid.")

    board = game.board()

    # Replay only the moves that precede the blunder position.
    for i, node in enumerate(game.mainline()):
        if i >= move_index:
            break
        board.push(node.move)

    engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)

    try:
        # multipv > 1 returns a list; multipv == 1 returns a single dict.
        infos = engine.analyse(board, chess.engine.Limit(depth=DEPTH), multipv=n_best)

        # Normalise to a list so the loop below is always the same.
        if isinstance(infos, dict):
            infos = [infos]

        best_moves: list[str] = []
        for info in infos:
            pv = info.get("pv")
            if pv:
                best_moves.append(pv[0].uci())

        return best_moves

    finally:
        engine.quit()
