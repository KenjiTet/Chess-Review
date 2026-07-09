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
import random
import threading
from datetime import date, datetime, timedelta, timezone

from services import chess_com
from services import trainer
from services.db import get_connection

# ── Configuration (env-overridable) ─────────────────────────────────────────
_ENABLED: bool = os.getenv("BLUNDER_OF_DAY_ENABLED", "true").lower() != "false"
# Size of the GM pool drawn from the live blitz leaderboard. The day's player is
# picked at random from this pool (top 50 by default) rather than always the best.
PLAYER_COUNT: int = int(os.getenv("BLUNDER_OF_DAY_PLAYER_COUNT", "50"))
# A GM used within this many days is excluded, so the same player never recurs in
# the same week's history.
RECENT_DAYS: int = int(os.getenv("BLUNDER_OF_DAY_RECENT_DAYS", "7"))
# Minimum centipawn loss for a move to count as a blunder.
THRESHOLD: int = int(os.getenv("BLUNDER_OF_DAY_THRESHOLD", "300"))
# How many recent blitz games to fetch per GM. This bounds the search depth: the
# scan walks the last game of every player, then the 2nd-last of every player, and
# so on down to this depth. Raise it if a day ever fails to find a blunder.
GAMES_PER_PLAYER: int = int(os.getenv("BLUNDER_OF_DAY_GAMES_PER_PLAYER", "20"))
# Seconds between worker wake-ups; each tick no-ops until the day rolls over.
POLL_INTERVAL: int = int(os.getenv("BLUNDER_OF_DAY_POLL_INTERVAL", "3600"))
# ISO date ("YYYY-MM-DD") of the first day to backfill history for on worker
# startup. Empty disables the automatic backfill. Runs once per boot and is
# idempotent — days that already have a puzzle are left untouched.
BACKFILL_START: str = os.getenv("BLUNDER_OF_DAY_BACKFILL_START", "")

# Categories that make for a clean tactical puzzle with a definite best move,
# preferred over "positional" blunders when choosing the day's position.
_TACTICAL_CATEGORIES: frozenset[str] = frozenset({
    "material_loss", "missed_mate", "allowed_mate", "missed_gain",
})

# Last fullmove that still counts as opening/middlegame. Blunders after this move
# are endgame positions and are excluded from the daily puzzle. Matches the phase
# boundary used in stats_aggregate.py (_MIDDLEGAME_MAX_FULLMOVE).
_MAX_FULLMOVE: int = 30

# ── Runtime state ────────────────────────────────────────────────────────────
_running: bool = False
_thread: threading.Thread | None = None
_stop_event = threading.Event()
# Set to break the poll-interval sleep early (e.g. on shutdown).
_wake_event = threading.Event()


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


def compute_for_day(
    day: str,
    exclude_players: set[str] | None = None,
    exclude_urls: set[str] | None = None,
) -> dict | None:
    """Find a blunder-of-the-day by scanning top GMs' recent games breadth-first.

    Draws the GM pool from the live blitz leaderboard (top PLAYER_COUNT), shuffles
    it so the day's player is random rather than always the best, then scans depth
    by depth: the last game of every candidate first, then the 2nd-last of every
    candidate, and so on. The first game that yields a qualifying tactical blunder
    the GM themselves made wins. There is no analysis cap — every game is scanned
    until a blunder is found or the fetched games (GAMES_PER_PLAYER deep) run out.

    Args:
        day: ISO date string ("YYYY-MM-DD"); kept for interface symmetry / logging.
        exclude_players: GM usernames (case-insensitive) to skip entirely, so a
            player used in the recent window is not reused.
        exclude_urls: Game URLs to skip, so no two days share the same game.

    Returns:
        A dict {game_url, player_username, blunder} on success, or None if no
        qualifying blunder was found within the fetched games.
    """
    # Normalise exclusions to lowercase sets for case-insensitive matching.
    excluded_players: set[str] = {player.lower() for player in exclude_players} if exclude_players else set()
    excluded_urls: set[str] = exclude_urls if exclude_urls else set()

    gms: list[str] = chess_com.get_top_blitz_gms(PLAYER_COUNT)

    # Drop any recently-used player, then shuffle so the chosen GM is random rather
    # than always the highest-rated one.
    candidates: list[str] = [gm for gm in gms if gm.lower() not in excluded_players]
    random.shuffle(candidates)

    if not candidates:
        return None

    # Fetch each candidate's recent blitz games once (most recent first). A single
    # GM's fetch failing must not abort the whole scan.
    games_by_gm: dict[str, list[dict]] = {}

    for gm in candidates:
        try:
            games_by_gm[gm] = chess_com.get_recent_games(gm, "blitz", GAMES_PER_PLAYER)
        except Exception:
            games_by_gm[gm] = []

    max_depth: int = max((len(games) for games in games_by_gm.values()), default=0)

    # Breadth-first by game depth: last game of every player, then 2nd-last, etc.
    for depth in range(max_depth):
        for gm in candidates:
            games: list[dict] = games_by_gm[gm]

            if depth >= len(games):
                continue

            game: dict = games[depth]
            pgn: str = game.get("pgn", "")
            url: str = game.get("url", "")

            if not pgn or not url:
                continue

            # Skip games already used on another day so no two days share a game.
            if url in excluded_urls:
                continue

            try:
                # build_session already filters to the GM's own blunders, reuses
                # the cache, and returns items in the BlunderResponse shape.
                session: dict = trainer.build_session(gm, "blitz", [game], THRESHOLD)
            except Exception:
                continue

            # Keep only blunders that are both (a) a concrete tactical type
            # (missed_gain, allowed_mate, etc.) so the puzzle shows a real category
            # rather than the generic "blunder" fallback, and (b) in the opening or
            # middlegame — endgame positions (past _MAX_FULLMOVE) are excluded.
            tactical: list[dict] = [
                blunder
                for blunder in session["all_blunders"]
                if blunder.get("category") in _TACTICAL_CATEGORIES
                and blunder.get("move_number", 0) <= _MAX_FULLMOVE
            ]

            if tactical:
                return {
                    "game_url": url,
                    "player_username": gm,
                    "blunder": _pick_best(tactical),
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


def _recent_exclusions(day: str) -> tuple[set[str], set[str]]:
    """Return players and game URLs used in the RECENT_DAYS window before `day`.

    A day's puzzle must not reuse a GM (or game) featured in the preceding week, so
    the same player never recurs within a week. Reads stored rows in the window
    [day - RECENT_DAYS, day - 1]; freshly filled days are already stored, so a
    backfill sees them too.

    Args:
        day: ISO date string ("YYYY-MM-DD") of the day being computed.

    Returns:
        A tuple (players, urls) drawn from rows in the recent window.
    """
    target: date = date.fromisoformat(day)
    window_start: str = (target - timedelta(days=RECENT_DAYS)).isoformat()
    window_end: str = (target - timedelta(days=1)).isoformat()

    with get_connection() as conn:
        rows = conn.execute(
            "SELECT player_username, game_url FROM blunder_of_day WHERE day >= ? AND day <= ?",
            (window_start, window_end),
        ).fetchall()

    players: set[str] = {row["player_username"] for row in rows}
    urls: set[str] = {row["game_url"] for row in rows}
    return players, urls


def backfill(start: str, end: str | None = None) -> dict[str, bool]:
    """Compute and store any missing daily puzzles across a date range.

    Walks every calendar day from `start` through `end` (inclusive) and, for any
    day that has no stored puzzle yet, computes one and persists it. Days that are
    already present are left untouched, so this is safe to re-run. Each day excludes
    the GMs and games used in the preceding RECENT_DAYS, so no player recurs within
    a week. Because each day is stored before the next is computed, the exclusion
    window (read from the DB) already reflects the days filled earlier in this run.

    Args:
        start: ISO date string ("YYYY-MM-DD") of the first day to fill.
        end: ISO date string of the last day to fill; defaults to today.

    Returns:
        A dict mapping each processed day to whether a puzzle was stored for it.
    """
    start_day: date = date.fromisoformat(start)

    if end is not None:
        end_day: date = date.fromisoformat(end)
    else:
        end_day = date.today()

    results: dict[str, bool] = {}
    current: date = start_day

    while current <= end_day:
        day: str = current.isoformat()

        if get_today(day) is not None:
            # Already have a puzzle for this day — skip without recomputing.
            results[day] = True
            current = current + timedelta(days=1)
            continue

        # Exclude players/games used in the week before this day.
        used_players, used_urls = _recent_exclusions(day)
        result: dict | None = compute_for_day(day, exclude_players=used_players, exclude_urls=used_urls)

        if result is not None:
            store_today(day, result)
            results[day] = True
        else:
            results[day] = False

        current = current + timedelta(days=1)

    return results


def _tick() -> None:
    """Compute and store today's blunder if it hasn't been computed yet."""
    day: str = date.today().isoformat()

    if get_today(day) is not None:
        # Already have today's puzzle — nothing to do until the day rolls over.
        return

    # Exclude players and games used in the past week so today's puzzle is a GM
    # that hasn't appeared recently.
    used_players, used_urls = _recent_exclusions(day)

    result: dict | None = compute_for_day(day, exclude_players=used_players, exclude_urls=used_urls)

    if result is not None:
        store_today(day, result)


def _run() -> None:
    """Worker loop: try to produce today's blunder, then sleep until the next tick."""
    # Backfill any missing history once per boot before entering the poll loop,
    # so prod fills the gap between BACKFILL_START and today automatically.
    if BACKFILL_START:
        try:
            backfill(BACKFILL_START)
        except Exception:
            # A failed backfill must never prevent the daily worker from running.
            pass

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
