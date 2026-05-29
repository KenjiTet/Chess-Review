"""Pure state management for the Chess Blunder Trainer session.

No Streamlit imports. All state is held in a plain dict passed explicitly
between functions — no global mutable state.
"""

from analysis import DEPTH, analyze_game, find_blunders, get_best_moves, get_board_snapshots
from cache import get_cached_game, is_cached, load_cache, save_cache, store_game


def build_session(
    username: str,
    time_class: str,
    games: list[dict],
    threshold: int,
) -> dict:
    """Assemble the full trainer session, using the disk cache to skip re-analysis.

    For each game, checks the cache first. On a cache hit all expensive data
    (move_data, fens, uci_moves, best_moves_per_blunder) is loaded instantly.
    On a cache miss, Stockfish analysis runs and the result is stored to cache.
    If the user lowers the blunder threshold, any newly exposed blunder positions
    that are missing from cache are computed and the cache entry is updated.

    Args:
        username: Chess.com username being trained.
        time_class: Time-control filter used to fetch games ("rapid", etc.).
        games: Raw game dicts from api.get_recent_games().
        threshold: Minimum centipawn loss to count as a blunder.

    Returns:
        Session dict with keys:
            username, time_class, games, all_blunders,
            current_position (int), attempts (list).
    """
    # Load the cache once; all per-game reads and writes reuse this dict.
    cache: dict = load_cache()
    all_blunders: list[dict] = []

    for game_index, game in enumerate(games):
        pgn: str = game.get("pgn", "")
        url: str = game.get("url", "")

        if not pgn:
            continue

        if is_cached(cache, url, DEPTH):
            # Fast path: load all pre-computed data from cache.
            print(f"Cache hit: {url}")
            entry: dict = get_cached_game(cache, url)
            move_data: list[dict] = entry["move_data"]
            fens: list[str] = entry["fens"]
            uci_moves: list[str] = entry["uci_moves"]
            # Make a mutable copy so we can add missing blunder positions below.
            best_moves_per_blunder: dict[str, list[str]] = dict(entry["best_moves_per_blunder"])

        else:
            # Slow path: run Stockfish analysis and persist results.
            print(f"Cache miss — analysing: {url}")
            move_data = analyze_game(pgn)
            fens, uci_moves = get_board_snapshots(pgn)
            best_moves_per_blunder = {}

        # Identify blunders for this session's threshold.
        blunders = find_blunders(move_data, min_cp_loss=threshold)

        # Track whether we computed any new best-moves data that must be saved.
        cache_needs_update: bool = not is_cached(cache, url, DEPTH)

        for blunder in blunders:
            move_index: int = blunder["move_index"]
            idx_str: str = str(move_index)
            fen_before: str = fens[move_index]
            uci_played: str = uci_moves[move_index]

            if idx_str not in best_moves_per_blunder:
                # Position not in cache (e.g. threshold was lowered) — compute it.
                best_moves_per_blunder[idx_str] = get_best_moves(pgn, move_index, n_best=3)
                cache_needs_update = True

            best_moves: list[str] = best_moves_per_blunder[idx_str]

            # Previous position/move so the UI can replay the opponent's last move.
            prev_fen: str | None = fens[move_index - 1] if move_index > 0 else None
            prev_move_uci: str | None = uci_moves[move_index - 1] if move_index > 0 else None

            all_blunders.append({
                "game_index": game_index,
                "move_index": move_index,
                "move_number": blunder["move_number"],
                "color": blunder["color"],
                "move_san": blunder["move_san"],
                "cp_loss": blunder["cp_loss"],
                "classification": blunder["classification"],
                "fen_before": fen_before,
                "uci_played": uci_played,
                "best_moves": best_moves,
                "prev_fen": prev_fen,
                "prev_move_uci": prev_move_uci,
            })

        if cache_needs_update:
            store_game(cache, url, pgn, move_data, fens, uci_moves, best_moves_per_blunder, DEPTH)

    return {
        "username": username,
        "time_class": time_class,
        "games": games,
        "all_blunders": all_blunders,
        "current_position": 0,
        "attempts": [],
    }


def get_current_blunder(session: dict) -> dict | None:
    """Return the blunder at the current position, or None if all reviewed.

    Args:
        session: Session dict produced by build_session().

    Returns:
        Blunder dict, or None if session["current_position"] is out of range.
    """
    position: int = session["current_position"]
    blunders: list[dict] = session["all_blunders"]

    if position >= len(blunders):
        return None

    return blunders[position]


def submit_attempt(session: dict, uci_move: str) -> dict:
    """Record the user's move attempt for the current blunder and advance.

    Checks whether the user's move is among the Stockfish best moves,
    appends the result to session["attempts"], and increments current_position.

    Args:
        session: Session dict (mutated in place).
        uci_move: UCI string of the move the user played (e.g. "e2e4").

    Returns:
        Result dict with keys:
            was_correct  : bool
            uci_played   : str   — what the user played
            uci_blunder  : str   — what was played in the actual game
            best_moves   : list[str]
            cp_loss      : int
    """
    position: int = session["current_position"]
    blunder: dict = session["all_blunders"][position]

    was_correct: bool = uci_move in blunder["best_moves"]

    attempt: dict = {
        "blunder_index": position,
        "uci_played_by_user": uci_move,
        "was_correct": was_correct,
        "best_move": blunder["best_moves"][0] if blunder["best_moves"] else None,
    }

    session["attempts"].append(attempt)
    session["current_position"] += 1

    return {
        "was_correct": was_correct,
        "uci_played": uci_move,
        "uci_blunder": blunder["uci_played"],
        "best_moves": blunder["best_moves"],
        "cp_loss": blunder["cp_loss"],
    }


def get_summary(session: dict) -> dict:
    """Compute end-of-session statistics.

    Args:
        session: Session dict produced by build_session().

    Returns:
        Dict with keys:
            total_blunders   : int
            total_reviewed   : int
            correct          : int
            accuracy_pct     : float
            worst_game_index : int  — game index with the most blunders
            best_game_index  : int  — game index with the fewest blunders
    """
    all_blunders: list[dict] = session["all_blunders"]
    attempts: list[dict] = session["attempts"]
    games: list[dict] = session["games"]

    total_blunders: int = len(all_blunders)
    total_reviewed: int = len(attempts)
    correct: int = sum(1 for a in attempts if a["was_correct"])

    accuracy_pct: float = (correct / total_reviewed * 100.0) if total_reviewed > 0 else 0.0

    # Count blunders per game to find the worst and best games.
    blunder_counts: dict[int, int] = {i: 0 for i in range(len(games))}
    for blunder in all_blunders:
        game_idx: int = blunder["game_index"]
        blunder_counts[game_idx] = blunder_counts.get(game_idx, 0) + 1

    worst_game_index: int = max(blunder_counts, key=lambda k: blunder_counts[k])
    best_game_index: int = min(blunder_counts, key=lambda k: blunder_counts[k])

    return {
        "total_blunders": total_blunders,
        "total_reviewed": total_reviewed,
        "correct": correct,
        "accuracy_pct": accuracy_pct,
        "worst_game_index": worst_game_index,
        "best_game_index": best_game_index,
    }
