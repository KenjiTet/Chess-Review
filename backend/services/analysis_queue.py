"""Background analysis queue.

Proactively analyses logged-in users' games so per-user stats are populated
without waiting for the user to open each game.

Two phases:
  A. Backfill — round-robin across accounts, newest game first, until each
     account has BACKFILL_TARGET analysed games (or runs out of games).
  B. Poll — once backfill is drained, every POLL_INTERVAL seconds check each
     account's most recent game and analyse it if it's new.

Runs in-process on the same Uvicorn container (single Railway service). One
scheduler thread drives a ThreadPoolExecutor; each Stockfish analysis runs in a
separate subprocess, so threads give real parallelism. Concurrency is kept low
by default to leave CPU headroom for user-facing session builds.
"""

import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from services.analysis_store import analyse_and_store, analysed_game_urls
from services.chess_com import get_recent_games_all as chesscom_recent_games_all
from services.db import get_connection
import services.lichess as lichess_svc

# ── Configuration (env-overridable) ────────────────────────────────────────
ANALYSIS_CONCURRENCY: int = int(os.getenv("ANALYSIS_CONCURRENCY", "2"))
BACKFILL_TARGET: int = int(os.getenv("BACKFILL_TARGET", "20"))
POLL_INTERVAL: int = int(os.getenv("POLL_INTERVAL", "60"))
_ENABLED: bool = os.getenv("ANALYSIS_QUEUE_ENABLED", "true").lower() != "false"

# ── Runtime state (guarded by _lock for status reads) ──────────────────────
_lock = threading.Lock()
_running: bool = False
_thread: threading.Thread | None = None
_stop_event = threading.Event()

_mode: str = "idle"           # "idle" | "backfill" | "poll"
_in_flight: set[str] = set()  # game URLs currently being analysed
_pending_by_stream: dict[str, int] = {}  # "username/platform" -> pending count
_analysed_total: int = 0      # games analysed since this process started


class _Stream:
    """One (account, platform) analysis stream."""

    def __init__(self, username_lower: str, platform: str, handle: str) -> None:
        self.username_lower = username_lower
        self.platform = platform
        self.handle = handle

    @property
    def key(self) -> str:
        """Stable identifier used for status reporting."""
        return f"{self.username_lower}/{self.platform}"


def _resolve_streams() -> list[_Stream]:
    """Return one analysis stream per (account, linked platform handle).

    Chess.com falls back to the account username when no handle is linked, so
    legacy accounts (created before linking) are still covered.
    """
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT username, username_lower, chesscom_username, lichess_username FROM users"
        ).fetchall()

    streams: list[_Stream] = []

    for row in rows:
        username_lower: str = row["username_lower"]

        chesscom_handle: str | None = row["chesscom_username"] or row["username"]
        if chesscom_handle:
            streams.append(_Stream(username_lower, "chesscom", chesscom_handle))

        lichess_handle: str | None = row["lichess_username"]
        if lichess_handle:
            streams.append(_Stream(username_lower, "lichess", lichess_handle))

    return streams


def _fetch_recent_games(platform: str, handle: str, n: int) -> list[dict]:
    """Fetch the n most recent games (full dicts) for a handle. Never raises."""
    try:
        if platform == "lichess":
            return lichess_svc.get_recent_games_all(handle, n)
        return chesscom_recent_games_all(handle, n)
    except Exception:
        # Network / API errors must not kill the scheduler loop.
        return []


def _analyse_one(stream: _Stream, game: dict) -> None:
    """Analyse and persist a single game, tracking in-flight status. Never raises."""
    url: str = game.get("url", "")

    with _lock:
        _in_flight.add(url)

    try:
        analyse_and_store(stream.username_lower, stream.platform, stream.handle, game)
        with _lock:
            global _analysed_total
            _analysed_total += 1
    except Exception:
        # Swallow per-game failures so one bad game doesn't stall the queue.
        pass
    finally:
        with _lock:
            _in_flight.discard(url)


def _build_backfill_tasks(streams: list[_Stream]) -> list[tuple[_Stream, dict]]:
    """Build a round-robin ordered task list of games still needing analysis.

    For each stream the BACKFILL_TARGET most recent games are fetched; those not
    yet recorded in user_analysed_games are pending. Pending games are then
    interleaved across streams (one per stream per round) so every account makes
    progress before any account is fully backfilled.
    """
    pending_lists: list[list[tuple[_Stream, dict]]] = []
    pending_counts: dict[str, int] = {}

    for stream in streams:
        recent: list[dict] = _fetch_recent_games(stream.platform, stream.handle, BACKFILL_TARGET)
        done: set[str] = analysed_game_urls(stream.username_lower)
        pending: list[tuple[_Stream, dict]] = [
            (stream, game)
            for game in recent
            if game.get("url") and game.get("url") not in done
        ]
        pending_lists.append(pending)
        pending_counts[stream.key] = len(pending)

    with _lock:
        _pending_by_stream.clear()
        _pending_by_stream.update(pending_counts)

    # Interleave round-robin: round 0 takes each stream's newest pending game, etc.
    tasks: list[tuple[_Stream, dict]] = []
    max_len: int = max((len(p) for p in pending_lists), default=0)

    for i in range(max_len):
        for pending in pending_lists:
            if i < len(pending):
                tasks.append(pending[i])

    return tasks


def _process(tasks: list[tuple[_Stream, dict]]) -> None:
    """Run the given tasks through the executor at bounded concurrency."""
    with ThreadPoolExecutor(max_workers=ANALYSIS_CONCURRENCY) as executor:
        futures = [
            executor.submit(_analyse_one, stream, game)
            for stream, game in tasks
        ]

        for _ in as_completed(futures):
            if _stop_event.is_set():
                # Stop waiting on shutdown; already-running analyses finish on their own.
                break


def _poll_once(streams: list[_Stream]) -> None:
    """Check each account's single most recent game and analyse it if new."""
    new_tasks: list[tuple[_Stream, dict]] = []

    for stream in streams:
        recent: list[dict] = _fetch_recent_games(stream.platform, stream.handle, 1)
        if not recent:
            continue

        game: dict = recent[0]
        url: str = game.get("url", "")
        done: set[str] = analysed_game_urls(stream.username_lower)

        if url and url not in done:
            new_tasks.append((stream, game))

    if new_tasks:
        _process(new_tasks)


def _run() -> None:
    """Scheduler loop: backfill until drained, then poll on an interval."""
    global _mode

    while not _stop_event.is_set():
        streams: list[_Stream] = _resolve_streams()
        tasks: list[tuple[_Stream, dict]] = _build_backfill_tasks(streams)

        if tasks:
            with _lock:
                _mode = "backfill"
            _process(tasks)
            # Loop straight back to re-evaluate (more games may now be pending).
            continue

        with _lock:
            _mode = "poll"
        _poll_once(streams)
        _stop_event.wait(POLL_INTERVAL)

    with _lock:
        _mode = "idle"


def start() -> None:
    """Start the background scheduler thread (no-op if disabled or already running)."""
    global _running, _thread

    if not _ENABLED or _running:
        return

    _running = True
    _stop_event.clear()
    _thread = threading.Thread(target=_run, name="analysis-queue", daemon=True)
    _thread.start()


def stop() -> None:
    """Signal the scheduler to stop. In-flight analyses finish on their own."""
    global _running

    if not _running:
        return

    _stop_event.set()
    _running = False


def get_queue_status() -> dict:
    """Return a snapshot of the queue state for the admin panel."""
    with _lock:
        return {
            "enabled": _ENABLED,
            "running": _running,
            "mode": _mode,
            "concurrency": ANALYSIS_CONCURRENCY,
            "backfill_target": BACKFILL_TARGET,
            "poll_interval": POLL_INTERVAL,
            "analysed_total": _analysed_total,
            "in_flight": sorted(_in_flight),
            "pending_by_stream": dict(_pending_by_stream),
        }
