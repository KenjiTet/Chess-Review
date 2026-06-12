"""User router — public player profile and ratings."""

from datetime import datetime, timezone

import requests as req_lib
from fastapi import APIRouter, Depends, HTTPException

from models import UserAnalysisStatusResponse, UserProfileResponse, UserStatsResponse
from services.analysis_queue import get_user_queue_status
from services.chess_com import get_player_profile as chesscom_get_profile
from services.chess_com import get_player_stats as chesscom_get_stats
from services.db import get_connection
from services.jwt_service import get_current_user

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


@router.get("/stats")
def user_stats(time_class: str, user: dict = Depends(get_current_user)) -> UserStatsResponse:
    """Return DB-derived training stats for the authenticated account.

    avg_blunders and games_analysed are filtered to the given time class; when
    time_class is "all" no filter is applied. blunders_drilled spans all time
    classes (it counts positions the user actually stepped through).

    Args (query params):
        time_class: Time class filter (rapid/blitz/bullet/daily) or "all".
        user: Injected JWT payload from the Authorization header.
    """
    username_lower: str = user["sub"].lower()

    with get_connection() as conn:
        if time_class == "all":
            agg = conn.execute(
                "SELECT COUNT(*) AS n, AVG(blunder_count) AS avg FROM user_analysed_games WHERE username_lower = ?",
                (username_lower,),
            ).fetchone()
        else:
            agg = conn.execute(
                "SELECT COUNT(*) AS n, AVG(blunder_count) AS avg FROM user_analysed_games WHERE username_lower = ? AND time_class = ?",
                (username_lower, time_class),
            ).fetchone()

        drilled = conn.execute(
            "SELECT COALESCE(SUM(positions_drilled), 0) AS total FROM user_reviewed_games WHERE username_lower = ?",
            (username_lower,),
        ).fetchone()

    games_analysed: int = agg["n"] or 0
    avg_blunders: float | None = agg["avg"]

    return UserStatsResponse(
        games_analysed=games_analysed,
        avg_blunders=avg_blunders,
        blunders_drilled=drilled["total"] or 0,
    )


@router.get("/profile")
def user_profile(username: str, platform: str = "chesscom") -> UserProfileResponse:
    """Fetch public profile info and ratings for a player.

    For Chess.com: fetches /pub/player/{username} (joined date) and
    /pub/player/{username}/stats (ratings for rapid, blitz, bullet).
    For Lichess: returns null ratings (not yet implemented).

    Args (query params):
        username: Player username.
        platform: "chesscom" or "lichess".

    Returns:
        UserProfileResponse with joined_year and per-time-class ratings.

    Raises:
        404 if the player is not found.
        502 on network errors.
    """
    if platform != "chesscom":
        return UserProfileResponse()

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
