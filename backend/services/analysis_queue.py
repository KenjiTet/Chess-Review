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
# Guests (player lookups with no account) get a shallower auto-analysis than
# logged-in accounts so we don't burn CPU on throwaway sessions.
GUEST_BACKFILL_TARGET: int = int(os.getenv("GUEST_BACKFILL_TARGET", "10"))
POLL_INTERVAL: int = int(os.getenv("POLL_INTERVAL", "60"))
# How many recent games each poll inspects per stream. Larger than 1 so a user
# who played several games between polls gets all of them analysed, not just the
# single newest one.
POLL_FETCH: int = int(os.getenv("POLL_FETCH", "20"))
_ENABLED: bool = os.getenv("ANALYSIS_QUEUE_ENABLED", "true").lower() != "false"

# ── Runtime state (guarded by _lock for status reads) ──────────────────────
_lock = threading.Lock()
_running: bool = False
_thread: threading.Thread | None = None
_stop_event = threading.Event()
# Set to break the poll-interval sleep early — e.g. when a user links a new
# handle and we want their games backfilled immediately instead of up to
# POLL_INTERVAL seconds later.
_wake_event = threading.Event()

_mode: str = "idle"           # "idle" | "backfill" | "poll"
_in_flight: set[str] = set()  # game URLs currently being analysed
_pending_by_stream: dict[str, int] = {}  # "username/platform" -> pending count
_analysed_total: int = 0      # games analysed since this process started

# Per-user views, keyed by username_lower, so the frontend can show live spinners
# on exactly the games this account currently has queued or in flight.
_in_flight_by_user: dict[str, set[str]] = {}  # username_lower -> URLs analysing now
_pending_by_user: dict[str, set[str]] = {}    # username_lower -> URLs waiting to analyse


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
    username_lower: str = stream.username_lower

    with _lock:
        _in_flight.add(url)
        # Promote from pending to in-flight in the per-user views.
        _in_flight_by_user.setdefault(username_lower, set()).add(url)
        user_pending: set[str] | None = _pending_by_user.get(username_lower)
        if user_pending is not None:
            user_pending.discard(url)

    try:
        analyse_and_store(username_lower, stream.platform, stream.handle, game)
        with _lock:
            global _analysed_total
            _analysed_total += 1
    except Exception:
        # Swallow per-game failures so one bad game doesn't stall the queue.
        pass
    finally:
        with _lock:
            _in_flight.discard(url)
            user_in_flight: set[str] | None = _in_flight_by_user.get(username_lower)
            if user_in_flight is not None:
                user_in_flight.discard(url)
                if not user_in_flight:
                    _in_flight_by_user.pop(username_lower, None)


def _set_pending_by_user(pending_urls_by_user: dict[str, set[str]]) -> None:
    """Replace the per-user pending view (caller must hold _lock).

    URLs already in flight are excluded so a game never shows as both queued and
    analysing at the same time.
    """
    _pending_by_user.clear()

    for username_lower, urls in pending_urls_by_user.items():
        in_flight: set[str] = _in_flight_by_user.get(username_lower, set())
        remaining: set[str] = urls - in_flight
        if remaining:
            _pending_by_user[username_lower] = remaining


def _build_backfill_tasks(streams: list[_Stream]) -> list[tuple[_Stream, dict]]:
    """Build a round-robin ordered task list of games still needing analysis.

    For each stream the BACKFILL_TARGET most recent games are fetched; those not
    yet recorded in user_analysed_games are pending. Pending games are then
    interleaved across streams (one per stream per round) so every account makes
    progress before any account is fully backfilled.
    """
    pending_lists: list[list[tuple[_Stream, dict]]] = []
    pending_counts: dict[str, int] = {}
    pending_urls_by_user: dict[str, set[str]] = {}

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

        # A user may own more than one stream (chess.com + lichess); union the URLs.
        user_urls: set[str] = pending_urls_by_user.setdefault(stream.username_lower, set())
        for _, game in pending:
            user_urls.add(game["url"])

    with _lock:
        _pending_by_stream.clear()
        _pending_by_stream.update(pending_counts)
        _set_pending_by_user(pending_urls_by_user)

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
    """Check each account's recent games and analyse any that are new.

    Inspects the POLL_FETCH most recent games per stream so a user who played
    several games since the last poll gets all of them analysed, not just the
    single newest one.
    """
    new_tasks: list[tuple[_Stream, dict]] = []
    pending_urls_by_user: dict[str, set[str]] = {}

    for stream in streams:
        recent: list[dict] = _fetch_recent_games(stream.platform, stream.handle, POLL_FETCH)
        done: set[str] = analysed_game_urls(stream.username_lower)

        user_urls: set[str] = pending_urls_by_user.setdefault(stream.username_lower, set())
        for game in recent:
            url: str = game.get("url", "")
            if url and url not in done:
                new_tasks.append((stream, game))
                user_urls.add(url)

    with _lock:
        _set_pending_by_user(pending_urls_by_user)

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
        # Sleep until the next poll, but wake early when stop() or
        # notify_streams_changed() sets the wake event.
        _wake_event.wait(POLL_INTERVAL)
        _wake_event.clear()

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
    # Wake the scheduler so it notices the stop without waiting out the poll sleep.
    _wake_event.set()
    _running = False


def _prefetch_pending(username_lower: str) -> None:
    """Populate one account's pending view synchronously.

    Lets the UI show analysing spinners the instant a user links a handle, before
    the scheduler's first backfill pass has run. Best-effort: network failures are
    swallowed so a slow platform API never blocks the link request for long.
    """
    streams: list[_Stream] = [
        stream for stream in _resolve_streams() if stream.username_lower == username_lower
    ]

    user_urls: set[str] = set()

    for stream in streams:
        recent: list[dict] = _fetch_recent_games(stream.platform, stream.handle, BACKFILL_TARGET)
        done: set[str] = analysed_game_urls(stream.username_lower)
        for game in recent:
            url: str = game.get("url", "")
            if url and url not in done:
                user_urls.add(url)

    with _lock:
        in_flight: set[str] = _in_flight_by_user.get(username_lower, set())
        remaining: set[str] = user_urls - in_flight
        if remaining:
            _pending_by_user[username_lower] = remaining
        else:
            _pending_by_user.pop(username_lower, None)


def notify_streams_changed(username_lower: str | None = None) -> None:
    """Wake the scheduler so a newly linked / changed handle is analysed at once.

    Args:
        username_lower: When given, that account's pending view is pre-populated
            synchronously so the UI shows spinners immediately; otherwise the
            scheduler simply re-evaluates all streams on its next (now-immediate) pass.
    """
    # Make sure the scheduler is running (no-op if it already is or is disabled).
    start()

    if username_lower:
        try:
            _prefetch_pending(username_lower)
        except Exception:
            # Never let prefetch failures bubble into the request that triggered the link.
            pass

    _wake_event.set()


def _run_guest_backfill(username_lower: str, platform: str, handle: str, n: int) -> None:
    """Analyse a guest stream's first n unanalysed games, tracking status. Never raises."""
    stream = _Stream(username_lower, platform, handle)

    recent: list[dict] = _fetch_recent_games(platform, handle, n)
    done: set[str] = analysed_game_urls(username_lower)

    pending: list[tuple[_Stream, dict]] = [
        (stream, game)
        for game in recent
        if game.get("url") and game.get("url") not in done
    ]

    if not pending:
        return

    # Register the pending view so the UI shows analysing spinners for the guest,
    # mirroring how the scheduler reports progress for logged-in accounts.
    with _lock:
        user_urls: set[str] = {game["url"] for _, game in pending}
        in_flight: set[str] = _in_flight_by_user.get(username_lower, set())
        remaining: set[str] = user_urls - in_flight
        if remaining:
            _pending_by_user[username_lower] = remaining

    _process(pending)


def enqueue_guest_backfill(
    username_lower: str,
    platform: str,
    handle: str,
    n: int = GUEST_BACKFILL_TARGET,
) -> None:
    """Kick a one-shot background analysis of a guest lookup's first n games.

    Guests have no row in the users table, so the scheduler never picks them up.
    This gives guest sessions the same auto-analysis as accounts, just shallower
    (n games instead of BACKFILL_TARGET). Fully detached so the identify request
    returns immediately; best-effort, so any failure is swallowed.

    Args:
        username_lower: Lowercased guest identity (the looked-up handle).
        platform: "chesscom" or "lichess".
        handle: The platform handle whose games to analyse.
        n: How many recent games to backfill (defaults to GUEST_BACKFILL_TARGET).
    """
    if not _ENABLED:
        return

    def _work() -> None:
        try:
            _run_guest_backfill(username_lower, platform, handle, n)
        except Exception:
            # A throwaway guest backfill must never crash anything.
            pass

    thread = threading.Thread(
        target=_work, name=f"guest-backfill-{username_lower}", daemon=True
    )
    thread.start()


def get_user_queue_status(username_lower: str) -> dict:
    """Return the live analysis state for a single account.

    Used by the frontend to show spinners on games the background queue is
    currently analysing or has queued for this user.

    Args:
        username_lower: Lowercased account username to report on.

    Returns:
        Dict with the queue mode plus this user's analysing/pending game URLs.
    """
    with _lock:
        return {
            "mode": _mode,
            "analysing": sorted(_in_flight_by_user.get(username_lower, set())),
            "pending": sorted(_pending_by_user.get(username_lower, set())),
        }


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
