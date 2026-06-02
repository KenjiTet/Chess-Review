"""Disk-backed JSON cache for Stockfish analysis results — port of chess-trainer/cache.py.

Games are keyed by Chess.com URL so they are never re-analysed.
Cache file is stored at recall/backend/cache/analysis_cache.json.
"""

import json
import os
from datetime import datetime, timezone

# One level up from services/ so cache lands at recall/backend/cache/
_CACHE_DIR: str = os.path.join(os.path.dirname(__file__), "..", "cache")
_CACHE_FILE: str = os.path.join(_CACHE_DIR, "analysis_cache.json")


def load_cache() -> dict:
    """Load the full cache dict from disk.

    Returns an empty dict if the file does not exist or contains invalid JSON.
    """
    try:
        with open(_CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_cache(cache: dict) -> None:
    """Write the cache dict to disk as formatted JSON.

    Creates the cache/ directory if it does not already exist.

    Args:
        cache: Full cache dict to persist.
    """
    os.makedirs(_CACHE_DIR, exist_ok=True)
    with open(_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)


def is_cached(cache: dict, game_url: str, depth: int) -> bool:
    """Return True if the game is in cache and was analysed at the given depth.

    Args:
        cache: In-memory cache dict from load_cache().
        game_url: Chess.com game URL (unique identifier).
        depth: Stockfish search depth; entries at a different depth are stale.
    """
    if game_url not in cache:
        return False
    return cache[game_url].get("depth") == depth


def get_cached_game(cache: dict, game_url: str) -> dict:
    """Return the cached entry for a game URL.

    Args:
        cache: In-memory cache dict from load_cache().
        game_url: Chess.com game URL.
    """
    return cache[game_url]


def store_game(
    cache: dict,
    game_url: str,
    pgn: str,
    move_data: list[dict],
    fens: list[str],
    uci_moves: list[str],
    best_moves_per_blunder: dict[str, list[str]],
    depth: int,
) -> None:
    """Add or update a game entry in cache and immediately persist to disk.

    Args:
        cache: In-memory cache dict (mutated in place).
        game_url: Chess.com game URL used as the cache key.
        pgn: Raw PGN string for the game.
        move_data: Output of analyze_game() for this game.
        fens: FEN snapshots from get_board_snapshots()[0].
        uci_moves: UCI move list from get_board_snapshots()[1].
        best_moves_per_blunder: Dict mapping move_index (as str) → list of UCI strings.
        depth: Stockfish depth used for this analysis.
    """
    # Use UTC time; strip the +00:00 suffix for a clean ISO string.
    now_iso: str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    cache[game_url] = {
        "pgn": pgn,
        "move_data": move_data,
        "fens": fens,
        "uci_moves": uci_moves,
        "best_moves_per_blunder": best_moves_per_blunder,
        "analysed_at": now_iso,
        "depth": depth,
    }
    save_cache(cache)


def get_cache_stats(cache: dict) -> dict:
    """Return summary statistics about the cache.

    Args:
        cache: In-memory cache dict from load_cache().

    Returns:
        Dict with keys:
            total_games   : int   — number of games stored
            total_size_kb : float — approximate size of the JSON file in KB
            oldest_entry  : str   — ISO datetime of the oldest analysed_at
            newest_entry  : str   — ISO datetime of the most recent analysed_at
    """
    total_games: int = len(cache)

    try:
        total_size_kb: float = os.path.getsize(_CACHE_FILE) / 1024
    except FileNotFoundError:
        total_size_kb = 0.0

    if not cache:
        return {
            "total_games": 0,
            "total_size_kb": total_size_kb,
            "oldest_entry": "",
            "newest_entry": "",
        }

    dates: list[str] = [
        entry["analysed_at"]
        for entry in cache.values()
        if "analysed_at" in entry
    ]

    return {
        "total_games": total_games,
        "total_size_kb": total_size_kb,
        "oldest_entry": min(dates) if dates else "",
        "newest_entry": max(dates) if dates else "",
    }
