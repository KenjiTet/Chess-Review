"""Blunder of the Day — daily background job + storage.

Once per calendar day, picks one of the platform's strongest blitz Grandmasters,
scans their recent blitz games, and stores the best blunder *they themselves*
made as that day's interactive puzzle.

Cost control is the whole point of this module:
  * Analysis is precomputed by a background worker, never on an HTTP request.
  * A day-keyed table makes the worker idempotent, so it can wake often and
    no-op until the calendar day rolls over.
  * Heavy Stockfish work is reused from trainer.build_session(), which checks
    the SQLite cache first, so any GM game analysed before (for any user) is
    free to re-scan.
  * A hard MAX_GAMES cap bounds how many *fresh* (cache-miss) analyses run per
    day; cached games never count against it.
"""

import json
import os
import threading
from datetime import date, datetime, timezone

from services import chess_com
from services import trainer
from services.cache import is_cached
from services.db import get_connection
from services.stockfish import DEPTH

# ── Configuration (env-overridable) ─────────────────────────────────────────
_ENABLED: bool = os.getenv("BLUNDER_OF_DAY_ENABLED", "true").lower() != "false"
# Size of the GM pool drawn from the live blitz leaderboard.
PLAYER_COUNT: int = int(os.getenv("BLUNDER_OF_DAY_PLAYER_COUNT", "10"))
# Minimum centipawn loss for a move to count as a blunder.
THRESHOLD: int = int(os.getenv("BLUNDER_OF_DAY_THRESHOLD", "300"))
# Hard cap on fresh (cache-miss) game analyses per day, across all GMs.
MAX_GAMES: int = int(os.getenv("BLUNDER_OF_DAY_MAX_GAMES", "12"))
# Recent blitz games to consider per GM before advancing to the next one.
GAMES_PER_PLAYER: int = int(os.getenv("BLUNDER_OF_DAY_GAMES_PER_PLAYER", "6"))
# Seconds between worker wake-ups; each tick no-ops until the day rolls over.
POLL_INTERVAL: int = int(os.getenv("BLUNDER_OF_DAY_POLL_INTERVAL", "3600"))

# Categories that make for a clean tactical puzzle with a definite best move,
# preferred over "positional" blunders when choosing the day's position.
_TACTICAL_CATEGORIES: frozenset[str] = frozenset({
    "material_loss", "missed_mate", "allowed_mate", "missed_gain",
})

# ── Runtime state ────────────────────────────────────────────────────────────
_running: bool = False
_thread: threading.Thread | None = None
_stop_event = threading.Event()
# Set to break the poll-interval sleep early (e.g. on shutdown).
_wake_event = threading.Event()

# cache-argument stub: cache functions use SQLite directly and ignore this arg.
_CACHE_STUB: dict = {}


def _pick_best(blunders: list[dict]) -> dict:
    """Choose the most puzzle-worthy blunder from a game's own-blunder list.

    Ranks tactical blunders (a concrete winning move exists) above positional
    ones, then by centipawn loss so the sharpest mistake wins.

    Args:
        blunders: Non-empty list of blunder dicts from trainer.build_session().

    Returns:
        The single chosen blunder dict.
    """
    def _rank(blunder: dict) -> tuple[int, int]:
        is_tactical: int = 1 if blunder.get("category") in _TACTICAL_CATEGORIES else 0
        return (is_tactical, blunder.get("cp_loss", 0))

    return max(blunders, key=_rank)


def compute_for_day(day: str) -> dict | None:
    """Find a fresh blunder-of-the-day without exceeding the daily analysis cap.

    Draws the GM pool from the live blitz leaderboard, rotates the starting GM by
    the calendar day (for day-to-day variety), then scans each GM's recent blitz
    games until one yields a blunder the GM themselves made. Only cache-miss
    analyses count against MAX_GAMES; cached games are scanned for free.

    Args:
        day: ISO date string ("YYYY-MM-DD") used to rotate the GM pool.

    Returns:
        A dict {game_url, player_username, blunder} on success, or None if no
        qualifying blunder was found within the analysis budget.
    """
    gms: list[str] = chess_com.get_top_blitz_gms(PLAYER_COUNT)

    if not gms:
        return None

    # Rotate the pool so a different GM leads each day rather than always the #1.
    start: int = date.fromisoformat(day).toordinal() % len(gms)
    ordered_gms: list[str] = gms[start:] + gms[:start]

    analysis_budget: int = MAX_GAMES

    for gm in ordered_gms:
        if analysis_budget <= 0:
            break

        try:
            games: list[dict] = chess_com.get_recent_games(gm, "blitz", GAMES_PER_PLAYER)
        except Exception:
            # A single GM's fetch failing must not abort the whole day's job.
            continue

        for game in games:
            pgn: str = game.get("pgn", "")
            url: str = game.get("url", "")

            if not pgn or not url:
                continue

            # A cache miss means a full ~60s Stockfish run — only those are budgeted.
            fresh: bool = not is_cached(_CACHE_STUB, url, DEPTH)

            if fresh and analysis_budget <= 0:
                break

            try:
                # build_session already filters to the GM's own blunders, reuses
                # the cache, and returns items in the BlunderResponse shape.
                session: dict = trainer.build_session(gm, "blitz", [game], THRESHOLD)
            except Exception:
                # Count the spent budget even on failure so a run of bad games
                # can't blow past the cap.
                if fresh:
                    analysis_budget -= 1
                continue

            if fresh:
                analysis_budget -= 1

            blunders: list[dict] = session["all_blunders"]

            if blunders:
                return {
                    "game_url": url,
                    "player_username": gm,
                    "blunder": _pick_best(blunders),
                }

    return None


def store_today(day: str, result: dict) -> None:
    """Persist a computed blunder as the given day's puzzle.

    Args:
        day: ISO date string ("YYYY-MM-DD") — primary key.
        result: The dict returned by compute_for_day().
    """
    now_iso: str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    blunder_json: str = json.dumps(result["blunder"])

    with get_connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO blunder_of_day
                (day, game_url, player_username, blunder_json, computed_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (day, result["game_url"], result["player_username"], blunder_json, now_iso),
        )
        conn.commit()


def get_today(day: str) -> dict | None:
    """Return the stored blunder for a specific day, or None if not computed yet.

    Args:
        day: ISO date string ("YYYY-MM-DD").

    Returns:
        The stored blunder dict (BlunderResponse shape), or None.
    """
    with get_connection() as conn:
        row = conn.execute(
            "SELECT blunder_json FROM blunder_of_day WHERE day = ?",
            (day,),
        ).fetchone()

    if row is None:
        return None

    return json.loads(row["blunder_json"])


def get_latest() -> dict | None:
    """Return the most recently computed blunder, whatever day it is from.

    Used as a fallback so the page is never empty when today's job hasn't yet
    produced a fresh blunder.

    Returns:
        The stored blunder dict (BlunderResponse shape), or None if the table is
        empty.
    """
    with get_connection() as conn:
        row = conn.execute(
            "SELECT blunder_json FROM blunder_of_day ORDER BY day DESC LIMIT 1"
        ).fetchone()

    if row is None:
        return None

    return json.loads(row["blunder_json"])


def get_history(limit: int = 30) -> list[dict]:
    """Return the most recent daily puzzles, newest first.

    Powers the Blunder of the Day hub's history list. Only reads stored rows —
    never triggers analysis.

    Args:
        limit: Maximum number of past days to return.

    Returns:
        A list of {day, blunder} dicts (blunder is BlunderResponse-shaped),
        ordered from most recent day to oldest.
    """
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT day, blunder_json FROM blunder_of_day ORDER BY day DESC LIMIT ?",
            (limit,),
        ).fetchall()

    return [{"day": row["day"], "blunder": json.loads(row["blunder_json"])} for row in rows]


def _tick() -> None:
    """Compute and store today's blunder if it hasn't been computed yet."""
    day: str = date.today().isoformat()

    if get_today(day) is not None:
        # Already have today's puzzle — nothing to do until the day rolls over.
        return

    result: dict | None = compute_for_day(day)

    if result is not None:
        store_today(day, result)


def _run() -> None:
    """Worker loop: try to produce today's blunder, then sleep until the next tick."""
    while not _stop_event.is_set():
        try:
            _tick()
        except Exception:
            # A failed tick must never kill the worker; it retries next wake-up.
            pass

        # Sleep until the next tick, waking early on stop().
        _wake_event.wait(POLL_INTERVAL)
        _wake_event.clear()


def start() -> None:
    """Start the background worker thread (no-op if disabled or already running)."""
    global _running, _thread

    if not _ENABLED or _running:
        return

    _running = True
    _stop_event.clear()
    _thread = threading.Thread(target=_run, name="blunder-of-day", daemon=True)
    _thread.start()


def stop() -> None:
    """Signal the worker to stop; an in-flight tick finishes on its own."""
    global _running

    if not _running:
        return

    _stop_event.set()
    _wake_event.set()
    _running = False
