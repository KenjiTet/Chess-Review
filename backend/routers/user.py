"""User router — public player profile and ratings."""

from datetime import datetime, timezone

import requests as req_lib
from fastapi import APIRouter, HTTPException

from models import UserProfileResponse
from services.chess_com import get_player_profile as chesscom_get_profile
from services.chess_com import get_player_stats as chesscom_get_stats

router = APIRouter()


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
    )
