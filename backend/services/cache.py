"""SQLite-backed cache for Stockfish analysis results.

Games are keyed by Chess.com URL so they are never re-analysed.
Each function opens its own connection — no in-memory dict is passed around.
"""

import json
import os
from datetime import datetime, timezone

from services.db import get_connection


# Kept for backward-compat with any callers that still import these names.
def load_cache() -> dict:
    """No-op stub — cache now lives in SQLite. Returns empty dict."""
    return {}


def save_cache(cache: dict) -> None:
    """No-op stub — cache now lives in SQLite."""
    pass


def is_cached(cache: dict, game_url: str, depth: int) -> bool:
    """Return True if the game is in SQLite and was analysed at the given depth.

    Args:
        cache: Ignored (kept for interface compatibility).
        game_url: Chess.com game URL (unique identifier).
        depth: Stockfish search depth; entries at a different depth are stale.
    """
    with get_connection() as conn:
        row = conn.execute(
            "SELECT depth FROM game_cache WHERE url = ?", (game_url,)
        ).fetchone()

    if row is None:
        return False

    return row["depth"] == depth


def get_cached_game(cache: dict, game_url: str) -> dict:
    """Return the cached entry for a game URL, deserialising JSON columns.

    Args:
        cache: Ignored (kept for interface compatibility).
        game_url: Chess.com game URL.
    """
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM game_cache WHERE url = ?", (game_url,)
        ).fetchone()

    return {
        "pgn": row["pgn"],
        "move_data": json.loads(row["move_data"]),
        "fens": json.loads(row["fens"]),
        "uci_moves": json.loads(row["uci_moves"]),
        "best_moves_per_blunder": json.loads(row["best_moves_per_blunder"]),
        # Legacy rows (analysed before this column shipped) have an empty map;
        # callers fall back to eval-only categorisation for those.
        "categories_per_blunder": json.loads(row["categories_per_blunder"] or "{}"),
        "analysed_at": row["analysed_at"],
        "depth": row["depth"],
    }


def store_game(
    cache: dict,
    game_url: str,
    pgn: str,
    move_data: list[dict],
    fens: list[str],
    uci_moves: list[str],
    best_moves_per_blunder: dict[str, list[str]],
    depth: int,
    categories_per_blunder: dict[str, str] | None = None,
) -> None:
    """Insert or replace a game entry in SQLite.

    Args:
        cache: Ignored (kept for interface compatibility).
        game_url: Chess.com game URL used as the primary key.
        pgn: Raw PGN string for the game.
        move_data: Output of analyze_game() for this game.
        fens: FEN snapshots from get_board_snapshots()[0].
        uci_moves: UCI move list from get_board_snapshots()[1].
        best_moves_per_blunder: Dict mapping move_index (str) → list of UCI strings.
        depth: Stockfish depth used for this analysis.
        categories_per_blunder: Dict mapping move_index (str) → blunder category.
            Defaults to an empty map (categories backfill on the next analysis).
    """
    now_iso: str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    with get_connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO game_cache
                (url, pgn, move_data, fens, uci_moves, best_moves_per_blunder, analysed_at, depth, categories_per_blunder)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                game_url,
                pgn,
                json.dumps(move_data),
                json.dumps(fens),
                json.dumps(uci_moves),
                json.dumps(best_moves_per_blunder),
                now_iso,
                depth,
                json.dumps(categories_per_blunder or {}),
            ),
        )
        conn.commit()


def get_cache_stats(cache: dict) -> dict:
    """Return summary statistics about the cache.

    Args:
        cache: Ignored (kept for interface compatibility).

    Returns:
        Dict with keys:
            total_games   : int   — number of games stored
            total_size_kb : float — approximate DB file size in KB
            oldest_entry  : str   — ISO datetime of the oldest analysed_at
            newest_entry  : str   — ISO datetime of the most recent analysed_at
    """
    from services.db import _DB_PATH

    try:
        total_size_kb: float = os.path.getsize(_DB_PATH) / 1024
    except FileNotFoundError:
        total_size_kb = 0.0

    with get_connection() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS cnt, MIN(analysed_at) AS oldest, MAX(analysed_at) AS newest FROM game_cache"
        ).fetchone()

    return {
        "total_games": row["cnt"],
        "total_size_kb": total_size_kb,
        "oldest_entry": row["oldest"] or "",
        "newest_entry": row["newest"] or "",
    }
