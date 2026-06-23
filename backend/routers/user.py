"""User router — public player profile and ratings."""

from datetime import datetime, timezone

import requests as req_lib
from fastapi import APIRouter, Depends, HTTPException

from models import (
    AccountStats,
    RatingRecord,
    UserAnalysisStatusResponse,
    UserFullStatsResponse,
    UserProfileResponse,
    UserStatsResponse,
)
from services.analysis_queue import get_user_queue_status
from services.analysis_store import CANONICAL_THRESHOLD
from services.cache import get_cached_game
from services.chess_com import get_player_profile as chesscom_get_profile
from services.chess_com import get_player_stats as chesscom_get_stats
import services.lichess as lichess_svc
from services.db import get_connection
from services.jwt_service import get_current_user
from services.stats_aggregate import get_full_stats
from services.stockfish import find_blunders

# Chess.com stats keys for the time classes we surface, mapped to our short keys.
_CHESSCOM_RATING_KEYS: dict[str, str] = {
    "chess_rapid": "rapid",
    "chess_blitz": "blitz",
    "chess_bullet": "bullet",
    "chess_daily": "daily",
}

# Lichess perf keys for the time classes we surface, mapped to our short keys.
# Lichess has no "daily" perf — its slow time control is "classical".
_LICHESS_RATING_KEYS: dict[str, str] = {
    "rapid": "rapid",
    "blitz": "blitz",
    "bullet": "bullet",
    "classical": "daily",
}

router = APIRouter()


@router.get("/analysis-status")
def user_analysis_status(user: dict = Depends(get_current_user)) -> UserAnalysisStatusResponse:
    """Return the background queue's live analysis state for the authenticated account.

    The frontend polls this to show a spinner on each game the queue is currently
    analysing (and to refresh a game's blunder count once it leaves the list).

    Args:
        user: Injected JWT payload from the Authorization header.
    """
    username_lower: str = user["sub"].lower()
    status: dict = get_user_queue_status(username_lower)

    return UserAnalysisStatusResponse(
        mode=status["mode"],
        analysing=status["analysing"],
        pending=status["pending"],
    )


def _recompute_avg_blunders(rows: list[dict], threshold: int) -> float | None:
    """Recompute avg blunders per game at an arbitrary threshold.

    The stored blunder_count column is fixed at CANONICAL_THRESHOLD, so when the
    user picks a different severity we recount from each game's cached move_data
    (raw evals stay in game_cache). Only the player's own blunders count, matching
    how the count was originally recorded.

    Args:
        rows: user_analysed_games rows, each exposing game_url and player_color.
        threshold: Minimum centipawn loss to count as a blunder.

    Returns:
        Mean blunder count across the games, or None when there are no games.
    """
    if not rows:
        return None

    total: int = 0
    counted: int = 0

    for row in rows:
        try:
            cached = get_cached_game({}, row["game_url"])
        except (TypeError, KeyError):
            # Game recorded but its evals are no longer cached — skip it so a
            # missing entry can't crash the whole stats request.
            continue

        blunders: list[dict] = find_blunders(cached["move_data"], min_cp_loss=threshold)
        # Only the player's own blunders count.
        own_blunders = [b for b in blunders if b.get("color") == row["player_color"]]
        total += len(own_blunders)
        counted += 1

    if counted == 0:
        return None

    return total / counted


@router.get("/stats")
def user_stats(
    time_class: str,
    threshold: int = CANONICAL_THRESHOLD,
    handle: str | None = None,
    user: dict = Depends(get_current_user),
) -> UserStatsResponse:
    """Return DB-derived training stats for the authenticated account.

    avg_blunders and games_analysed are filtered to the given time class; when
    time_class is "all" no filter is applied. blunders_drilled spans all time
    classes (it counts positions the user actually stepped through).

    avg_blunders honours the requested severity threshold: at the canonical
    default we use the fast stored column; at any other threshold we recompute
    from each game's cached move_data so the stat tracks the slider.

    When a handle is given, stats are scoped to that linked platform username, so
    an account that has linked several handles sees only the active handle's games
    (and switching handles never mixes their numbers).

    Args (query params):
        time_class: Time class filter (rapid/blitz/bullet/daily) or "all".
        threshold: Blunder severity in centipawns (defaults to the canonical value).
        handle: Linked platform username to scope the stats to (optional).
        user: Injected JWT payload from the Authorization header.
    """
    username_lower: str = user["sub"].lower()

    # Build the analysed-games filter shared by the count/avg and recompute queries.
    where: str = "username_lower = ?"
    params: list = [username_lower]

    if time_class != "all":
        where += " AND time_class = ?"
        params.append(time_class)

    if handle:
        # Case-insensitive: new rows store a lowercased handle, but legacy rows
        # backfilled from the users table keep their original casing.
        where += " AND LOWER(handle) = ?"
        params.append(handle.lower())

    with get_connection() as conn:
        agg = conn.execute(
            f"SELECT COUNT(*) AS n, AVG(blunder_count) AS avg FROM user_analysed_games WHERE {where}",
            tuple(params),
        ).fetchone()

        drilled = conn.execute(
            "SELECT COALESCE(SUM(positions_drilled), 0) AS total FROM user_reviewed_games WHERE username_lower = ?",
            (username_lower,),
        ).fetchone()

        # At a non-default threshold the stored counts no longer apply — pull the
        # game list so we can recompute avg_blunders from cached evals.
        if threshold != CANONICAL_THRESHOLD:
            game_rows = conn.execute(
                f"SELECT game_url, player_color FROM user_analysed_games WHERE {where}",
                tuple(params),
            ).fetchall()
        else:
            game_rows = []

    games_analysed: int = agg["n"] or 0

    if threshold != CANONICAL_THRESHOLD:
        avg_blunders: float | None = _recompute_avg_blunders(game_rows, threshold)
    else:
        avg_blunders = agg["avg"]

    return UserStatsResponse(
        games_analysed=games_analysed,
        avg_blunders=avg_blunders,
        blunders_drilled=drilled["total"] or 0,
    )


def _country_code(country_url: str | None) -> str | None:
    """Extract the 2-letter country code from a Chess.com country URL.

    Chess.com returns country as a URL like ".../pub/country/US"; we keep only the
    trailing code for display.

    Args:
        country_url: The raw country URL from the profile, or None.
    """
    if not country_url:
        return None

    return country_url.rstrip("/").rsplit("/", 1)[-1]


def _build_account_stats(handle: str) -> AccountStats:
    """Build section A (platform ratings/records) from the Chess.com API.

    Covers all played games (not just the analysed subset). Returns an empty
    AccountStats when the platform lookup fails so the dashboard still renders the
    analysis-derived sections.

    Args:
        handle: The linked Chess.com handle to fetch.
    """
    try:
        profile: dict = chesscom_get_profile(handle)
        stats: dict = chesscom_get_stats(handle)
    except (ValueError, req_lib.RequestException):
        # Platform unreachable / unknown handle — degrade gracefully to empty.
        return AccountStats()

    joined_year: int | None = None
    joined_ts: int | None = profile.get("joined")

    if joined_ts is not None:
        joined_year = datetime.fromtimestamp(joined_ts, tz=timezone.utc).year

    ratings: dict[str, RatingRecord] = {}
    total_games: int = 0
    total_wins: int = 0

    for api_key, short_key in _CHESSCOM_RATING_KEYS.items():
        block: dict = stats.get(api_key, {})

        if not block:
            continue

        record: dict = block.get("record", {})
        wins: int = record.get("win", 0)
        losses: int = record.get("loss", 0)
        draws: int = record.get("draw", 0)

        ratings[short_key] = RatingRecord(
            current=block.get("last", {}).get("rating"),
            peak=block.get("best", {}).get("rating"),
            peak_date=block.get("best", {}).get("date"),
            wins=wins,
            losses=losses,
            draws=draws,
        )

        total_games += wins + losses + draws
        total_wins += wins

    overall_win_rate: float | None = None

    if total_games > 0:
        overall_win_rate = total_wins / total_games * 100

    return AccountStats(
        joined_year=joined_year,
        avatar=profile.get("avatar"),
        country=_country_code(profile.get("country")),
        followers=profile.get("followers"),
        league=profile.get("league"),
        name=profile.get("name"),
        title=profile.get("title"),
        ratings=ratings,
        total_games=total_games,
        overall_win_rate=overall_win_rate,
    )


def _build_lichess_account_stats(handle: str) -> AccountStats:
    """Build section A (platform ratings/records) from the Lichess API.

    Lichess exposes per-perf ratings but not per-perf W/L/D records or peak
    ratings, so those fields stay at their defaults; the overall record comes from
    the profile-wide `count` block. Returns an empty AccountStats when the lookup
    fails so the dashboard still renders the analysis-derived sections.

    Args:
        handle: The linked Lichess handle to fetch.
    """
    try:
        profile: dict = lichess_svc.get_player_profile(handle)
    except (ValueError, req_lib.RequestException):
        # Platform unreachable / unknown handle — degrade gracefully to empty.
        return AccountStats()

    perfs: dict = profile.get("perfs", {})

    ratings: dict[str, RatingRecord] = {}

    for perf_key, short_key in _LICHESS_RATING_KEYS.items():
        block: dict = perfs.get(perf_key, {})

        # Lichess returns provisional perfs with 0 games — skip unplayed classes.
        if not block or not block.get("games"):
            continue

        # Lichess gives no per-perf W/L/D or peak; only the current rating.
        ratings[short_key] = RatingRecord(current=block.get("rating"))

    # Profile-wide record (all time classes combined).
    count: dict = profile.get("count", {})
    wins: int = count.get("win", 0)
    losses: int = count.get("loss", 0)
    draws: int = count.get("draw", 0)

    total_games: int = wins + losses + draws
    overall_win_rate: float | None = None

    if total_games > 0:
        overall_win_rate = wins / total_games * 100

    # Lichess country lives under the nested profile block; no public avatar.
    profile_block: dict = profile.get("profile", {})

    return AccountStats(
        joined_year=_lichess_joined_year(profile),
        avatar=None,
        country=profile_block.get("country"),
        followers=profile.get("nbFollowers"),
        league=None,
        name=profile_block.get("realName"),
        title=profile.get("title"),
        ratings=ratings,
        total_games=total_games,
        overall_win_rate=overall_win_rate,
    )


@router.get("/stats/full")
def user_stats_full(
    handle: str,
    platform: str = "chesscom",
    user: dict = Depends(get_current_user),
) -> UserFullStatsResponse:
    """Return the full stats dashboard for the authenticated account + linked handle.

    Merges live platform ratings/records (section A, all played games) with the
    cached analysis-derived aggregate (sections B–E, the analysed subset). The
    heavy aggregate is recomputed only when its content signature changes.

    Args (query params):
        handle: Linked platform username the analysed stats are scoped to.
        platform: "chesscom" or "lichess" (both provide section A ratings).
        user: Injected JWT payload from the Authorization header.
    """
    username_lower: str = user["sub"].lower()
    aggregate: dict = get_full_stats(username_lower, handle.lower())

    if platform == "lichess":
        account: AccountStats = _build_lichess_account_stats(handle)
    else:
        account = _build_account_stats(handle)

    return UserFullStatsResponse(
        account=account,
        training=aggregate["training"],
        engagement=aggregate["engagement"],
        blunder_types=aggregate["blunder_types"],
        phases=aggregate["phases"],
        colors=aggregate["colors"],
        severity=aggregate["severity"],
        avg_cp_loss=aggregate["avg_cp_loss"],
    )


def _lichess_joined_year(profile: dict) -> int | None:
    """Extract the join year from a Lichess profile (createdAt is epoch milliseconds)."""
    created_ms: int | None = profile.get("createdAt")

    if created_ms is None:
        return None

    return datetime.fromtimestamp(created_ms / 1000, tz=timezone.utc).year


def _lichess_profile(username: str) -> UserProfileResponse:
    """Build the public profile response for a Lichess player.

    Lichess returns all per-perf ratings on the single /api/user endpoint, so one
    call covers both the joined date and the rapid/blitz/bullet ratings. Lichess
    has no public avatar, so that stays unset (the UI falls back to its logo).

    Args:
        username: Lichess username.

    Raises:
        404 if the player is not found.
        502 on network errors.
    """
    try:
        profile: dict = lichess_svc.get_player_profile(username)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except req_lib.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"API error: {exc}")

    perfs: dict = profile.get("perfs", {})

    rapid: int | None = perfs.get("rapid", {}).get("rating")
    blitz: int | None = perfs.get("blitz", {}).get("rating")
    bullet: int | None = perfs.get("bullet", {}).get("rating")

    return UserProfileResponse(
        joined_year=_lichess_joined_year(profile),
        rapid_rating=rapid,
        blitz_rating=blitz,
        bullet_rating=bullet,
        avatar=None,
    )


@router.get("/profile")
def user_profile(username: str, platform: str = "chesscom") -> UserProfileResponse:
    """Fetch public profile info and ratings for a player.

    For Chess.com: fetches /pub/player/{username} (joined date) and
    /pub/player/{username}/stats (ratings for rapid, blitz, bullet).
    For Lichess: fetches /api/user/{username} (joined date + per-perf ratings).

    Args (query params):
        username: Player username.
        platform: "chesscom" or "lichess".

    Returns:
        UserProfileResponse with joined_year and per-time-class ratings.

    Raises:
        404 if the player is not found.
        502 on network errors.
    """
    if platform == "lichess":
        return _lichess_profile(username)

    try:
        profile: dict = chesscom_get_profile(username)
        stats: dict = chesscom_get_stats(username)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except req_lib.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"API error: {exc}")

    joined_year: int | None = None
    joined_ts: int | None = profile.get("joined")

    if joined_ts is not None:
        joined_year = datetime.fromtimestamp(joined_ts, tz=timezone.utc).year

    rapid: int | None = stats.get("chess_rapid", {}).get("last", {}).get("rating")
    blitz: int | None = stats.get("chess_blitz", {}).get("last", {}).get("rating")
    bullet: int | None = stats.get("chess_bullet", {}).get("last", {}).get("rating")

    return UserProfileResponse(
        joined_year=joined_year,
        rapid_rating=rapid,
        blitz_rating=blitz,
        bullet_rating=bullet,
        avatar=profile.get("avatar"),
    )
