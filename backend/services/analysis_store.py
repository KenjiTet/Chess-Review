"""Shared analyse-and-persist logic.

A single code path used by both the on-demand HTTP route (games router) and the
background analysis queue. It runs (or reuses cached) Stockfish analysis for a
game, then records a per-user row in user_analysed_games so each account's stats
can be derived from the database.
"""

from datetime import datetime, timezone

from services.cache import get_cached_game, is_cached, store_game
from services.categorize import resolve_category
from services.db import get_connection
from services.stockfish import (
    DEPTH,
    analyze_game,
    find_blunders,
    get_best_moves,
    get_board_snapshots,
)

# Canonical blunder threshold used when recording per-user blunder counts.
# Matches the app's default UI threshold so stored counts line up with what the
# user sees by default. Raw move_data stays in game_cache, so counts can be
# recomputed at a different threshold later if needed.
CANONICAL_THRESHOLD: int = 300

# Chess.com result values that indicate a draw (player POV).
_DRAW_RESULTS: frozenset[str] = frozenset({
    "stalemate", "agreed", "repetition", "insufficient",
    "timevsinsufficient", "50move",
})


def player_color_in(game: dict, username_lower: str) -> str | None:
    """Return which colour the account played ("white" | "black"), or None.

    Returns None when the handle matches neither side, so callers can refuse to
    record a misattributed row rather than silently defaulting to "black" (which
    would count the opponent's blunders as the player's — or, more often, zero the
    player's own blunders out).

    Args:
        game: Game dict from the platform API (must include white/black usernames).
        username_lower: Lowercased handle whose colour we are resolving.
    """
    white: dict = game.get("white", {})
    black: dict = game.get("black", {})

    if white.get("username", "").lower() == username_lower:
        return "white"

    if black.get("username", "").lower() == username_lower:
        return "black"

    # Handle matches neither side — caller decides how to handle it.
    return None


def player_result(game: dict, username_lower: str) -> str:
    """Return the game result ("win" | "lose" | "draw") from the player's perspective."""
    white: dict = game.get("white", {})
    black: dict = game.get("black", {})

    if black.get("username", "").lower() == username_lower:
        side_result: str = black.get("result", "")
    else:
        side_result = white.get("result", "")

    if side_result == "win":
        return "win"

    if side_result in _DRAW_RESULTS:
        return "draw"

    return "lose"


def _ensure_analysis(game_url: str, pgn: str) -> list[dict]:
    """Return move_data for a game, reusing the cache or running Stockfish and caching.

    Args:
        game_url: Game URL — primary key into game_cache.
        pgn: Raw PGN, used when a fresh analysis is required.

    Returns:
        The move_data list produced by analyze_game().
    """
    # cache stub: cache functions use SQLite directly and ignore this arg.
    cache: dict = {}

    if is_cached(cache, game_url, DEPTH):
        return get_cached_game(cache, game_url)["move_data"]

    move_data: list[dict] = analyze_game(pgn)
    fens: list[str]
    uci_moves: list[str]
    fens, uci_moves = get_board_snapshots(pgn)

    # Precompute best moves + categories for all blunders at the canonical threshold
    # so the game history list shows real categories (not the eval-only fallback).
    # Blunders exposed only by a lower threshold are filled in later by the session build.
    best_moves_per_blunder: dict[str, list[str]] = {}
    categories_per_blunder: dict[str, str] = {}

    for blunder in find_blunders(move_data, min_cp_loss=CANONICAL_THRESHOLD):
        move_index: int = blunder["move_index"]
        idx_str: str = str(move_index)
        best_moves_per_blunder[idx_str] = get_best_moves(pgn, move_index, n_best=3)
        categories_per_blunder[idx_str] = resolve_category(move_data, fens, uci_moves, move_index, best_moves_per_blunder[idx_str])

    store_game(cache, game_url, pgn, move_data, fens, uci_moves, best_moves_per_blunder, DEPTH, categories_per_blunder)

    return move_data


def analyse_and_store(account_username_lower: str, platform: str, handle: str, game: dict) -> dict:
    """Analyse a game (or reuse cache) and persist a per-user analysed-game row.

    Idempotent on (account_username_lower, game_url): re-running updates the row.

    The row is keyed by the *account* username, but which colour the player took
    is resolved from the *platform handle* — these differ when the login name is
    not the same as the linked Chess.com / Lichess handle.

    Args:
        account_username_lower: Lowercased account username the row belongs to.
        platform: "chesscom" or "lichess".
        handle: The platform handle whose games these are (used for colour/result).
        game: Game dict from the platform API (must include url, pgn, white, black).

    Returns:
        Summary dict: {game_url, blunder_count, player_color, result, time_class}.
    """
    game_url: str = game.get("url", "")
    pgn: str = game.get("pgn", "")
    handle_lower: str = handle.lower()

    color: str | None = player_color_in(game, handle_lower)
    result: str = player_result(game, handle_lower)
    time_class: str = game.get("time_class", "")
    end_time: int = game.get("end_time", 0)

    # Guard against misattribution: if the handle plays neither side, recording a
    # row would zero the player's own blunders (the colour filter below matches
    # nothing). Skip rather than overwrite a previously-correct row with a 0.
    if color is None:
        return _existing_row_summary(account_username_lower, game_url, time_class)

    move_data: list[dict] = _ensure_analysis(game_url, pgn)

    # An empty move_data means the analysis failed (no engine output), not that
    # the game is blunder-free. Writing blunder_count=0 here would silently wipe a
    # good stored average on a re-link/re-analysis, so keep the existing row.
    if not move_data:
        return _existing_row_summary(account_username_lower, game_url, time_class)

    # Only the player's own blunders count, matching the trainer's behaviour.
    blunders: list[dict] = find_blunders(move_data, min_cp_loss=CANONICAL_THRESHOLD)
    blunders = [b for b in blunders if b.get("color") == color]
    blunder_count: int = len(blunders)

    now_iso: str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    with get_connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO user_analysed_games
                (username_lower, game_url, platform, handle, time_class, player_color, result, blunder_count, end_time, analysed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (account_username_lower, game_url, platform, handle_lower, time_class, color, result, blunder_count, end_time, now_iso),
        )
        conn.commit()

    return {
        "game_url": game_url,
        "blunder_count": blunder_count,
        "player_color": color,
        "result": result,
        "time_class": time_class,
    }


def _existing_row_summary(username_lower: str, game_url: str, time_class: str) -> dict:
    """Return a summary for an already-stored row, or a zero summary if none.

    Used when a fresh analysis is refused (misattributed colour or failed engine
    run) so the caller still gets a sensible summary without clobbering the stored
    row. Reads back the preserved blunder_count/colour/result rather than fabricating
    them.

    Args:
        username_lower: Lowercased account username the row belongs to.
        game_url: Game URL identifying the row.
        time_class: Time class of the game (echoed back for the summary).
    """
    with get_connection() as conn:
        row = conn.execute(
            "SELECT blunder_count, player_color, result FROM user_analysed_games WHERE username_lower = ? AND game_url = ?",
            (username_lower, game_url),
        ).fetchone()

    if row is None:
        return {
            "game_url": game_url,
            "blunder_count": 0,
            "player_color": None,
            "result": "",
            "time_class": time_class,
        }

    return {
        "game_url": game_url,
        "blunder_count": row["blunder_count"],
        "player_color": row["player_color"],
        "result": row["result"],
        "time_class": time_class,
    }


def analysed_game_urls(username_lower: str) -> set[str]:
    """Return the set of game URLs already analysed for a user."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT game_url FROM user_analysed_games WHERE username_lower = ?",
            (username_lower,),
        ).fetchall()

    return {row["game_url"] for row in rows}


def clear_analysed_games(username_lower: str, platform: str) -> int:
    """Delete an account's recorded analysed games for a single platform.

    Called when the account's linked handle for that platform changes: the old
    handle's games no longer belong to this account, so their rows must go or the
    avg-blunders stat keeps reflecting the previous account.

    Args:
        username_lower: Lowercased account username.
        platform: "chesscom" or "lichess" — only this platform's rows are removed.

    Returns:
        Number of rows deleted.
    """
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM user_analysed_games WHERE username_lower = ? AND platform = ?",
            (username_lower, platform),
        )
        conn.commit()

    return cursor.rowcount
