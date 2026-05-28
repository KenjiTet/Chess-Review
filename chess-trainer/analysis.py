"""Stockfish-based chess move analysis utilities."""

import asyncio
import io
import sys

import chess
import chess.engine
import chess.pgn

# On Windows, python-chess spawns Stockfish via asyncio subprocesses.
# SelectorEventLoop (the default) does not support subprocess_exec — ProactorEventLoop does.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

STOCKFISH_PATH: str = r"C:\Users\Kenji\stockfish\stockfish-windows-x86-64-avx2.exe"
DEPTH: int = 15

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
            info_before = engine.analyse(board, chess.engine.Limit(depth=DEPTH))
            score_before: int = info_before["score"].relative.score(mate_score=_MATE_SCORE)

            board.push(move)

            # After the move, board.turn has flipped to the opponent.
            # .relative is now from the opponent's POV, so negate to stay with the mover.
            info_after = engine.analyse(board, chess.engine.Limit(depth=DEPTH))
            score_after: int = -info_after["score"].relative.score(mate_score=_MATE_SCORE)

            # Positive cp_loss means the mover's position worsened.
            cp_loss: int = max(0, score_before - score_after)

            results.append({
                "move_number": move_number,
                "color": color,
                "move_san": move_san,
                "cp_loss": cp_loss,
                "classification": classify_move(cp_loss),
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


def find_blunders(move_data: list[dict], min_cp_loss: int = 100) -> list[dict]:
    """Filter a move list to only moves that qualify as blunders.

    Args:
        move_data: Output of analyze_game().
        min_cp_loss: Minimum centipawn loss to qualify as a blunder (default 100).

    Returns:
        List of blunder dicts with an added "move_index" key (0-based index
        into the original move_data list).
    """
    result: list[dict] = []

    for i, move in enumerate(move_data):
        if move["cp_loss"] >= min_cp_loss:
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
        sf_move: str | None = result.move.uci() if result.move else None

        if sf_move:
            board.push(result.move)

        if board.is_game_over():
            score: int = _MATE_SCORE if board.result() == "1-0" else -_MATE_SCORE
            return (sf_move, score)

        info = engine.analyse(board, chess.engine.Limit(depth=depth))
        cp: int = info["score"].white().score(mate_score=_MATE_SCORE)
        return (sf_move, cp)

    finally:
        engine.quit()


def evaluate_move_quality(fen_before: str, uci_move: str, depth: int = 10) -> tuple[int, str, int]:
    """Evaluate the quality of a single move against Stockfish's assessment.

    Compares the position eval before and after the move to compute centipawn
    loss from the mover's perspective.

    Args:
        fen_before: FEN of the position before the move.
        uci_move: UCI string of the move (e.g. "e2e4").
        depth: Stockfish search depth for both evals.

    Returns:
        Tuple (cp_loss, classification, eval_after_white_pov) where:
            cp_loss              — centipawns lost by the mover (0 = best possible)
            classification       — best / good / inaccuracy / mistake / blunder
            eval_after_white_pov — eval after the move from white's POV (for the eval bar)
    """
    board = chess.Board(fen_before)

    if board.is_game_over():
        return (0, "best", 0)

    engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)

    try:
        # Eval before from the mover's perspective.
        info_before = engine.analyse(board, chess.engine.Limit(depth=depth))
        score_before: int = info_before["score"].relative.score(mate_score=_MATE_SCORE)

        board.push(chess.Move.from_uci(uci_move))

        if board.is_game_over():
            eval_white: int = _MATE_SCORE if board.result() == "1-0" else -_MATE_SCORE
            return (0, "best", eval_white)

        # After the move board.turn has flipped to the opponent.
        # .relative is from the opponent's POV — negate to stay with the mover.
        info_after = engine.analyse(board, chess.engine.Limit(depth=depth))
        score_after: int = -info_after["score"].relative.score(mate_score=_MATE_SCORE)
        eval_white: int = info_after["score"].white().score(mate_score=_MATE_SCORE)

        cp_loss: int = max(0, score_before - score_after)
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
