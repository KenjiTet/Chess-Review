"""Admin router — live DB inspection endpoints, restricted to admin users only."""

from fastapi import APIRouter, Depends

from services.analysis_queue import get_queue_status
from services.db import get_connection
from services.jwt_service import require_admin

router = APIRouter()


@router.get("/users")
def list_users(_admin: dict = Depends(require_admin)) -> list[dict]:
    """Return all registered users (password hashes excluded).

    Args:
        _admin: Injected admin guard — request is rejected if not admin.

    Returns:
        List of user rows: username, username_lower, created_at.
    """
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT username, username_lower, created_at, is_admin FROM users ORDER BY created_at DESC"
        ).fetchall()
    return [dict(row) for row in rows]


@router.get("/cache")
def list_cache(limit: int = 50, _admin: dict = Depends(require_admin)) -> list[dict]:
    """Return cached game analysis entries, most recent first.

    Args:
        limit: Maximum number of rows to return (default 50).
        _admin: Injected admin guard.

    Returns:
        List of game_cache rows with move_data parsed from JSON.
    """
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT url, analysed_at, depth FROM game_cache ORDER BY analysed_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


@router.get("/stats")
def db_stats(_admin: dict = Depends(require_admin)) -> dict:
    """Return aggregate DB stats.

    Args:
        _admin: Injected admin guard.

    Returns:
        Dict with total_users and total_cached_games counts.
    """
    with get_connection() as conn:
        user_count: int = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        cache_count: int = conn.execute("SELECT COUNT(*) FROM game_cache").fetchone()[0]
        analysed_count: int = conn.execute("SELECT COUNT(*) FROM user_analysed_games").fetchone()[0]
    return {
        "total_users": user_count,
        "total_cached_games": cache_count,
        "total_analysed_games": analysed_count,
    }


@router.get("/user-stats")
def user_stats(_admin: dict = Depends(require_admin)) -> list[dict]:
    """Return per-user aggregate stats derived from user_analysed_games.

    Args:
        _admin: Injected admin guard.

    Returns:
        One row per user that has analysed games, with counts and averages.
    """
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                a.username_lower                                       AS username_lower,
                COALESCE(u.username, a.username_lower)                 AS username,
                COUNT(*)                                              AS games_analysed,
                SUM(a.blunder_count)                                  AS total_blunders,
                AVG(a.blunder_count)                                  AS avg_blunders,
                SUM(CASE WHEN a.result = 'win'  THEN 1 ELSE 0 END)    AS wins,
                SUM(CASE WHEN a.result = 'draw' THEN 1 ELSE 0 END)    AS draws,
                SUM(CASE WHEN a.result = 'lose' THEN 1 ELSE 0 END)    AS losses,
                COALESCE((
                    SELECT SUM(r.positions_drilled)
                    FROM user_reviewed_games r
                    WHERE r.username_lower = a.username_lower
                ), 0)                                                 AS blunders_drilled
            FROM user_analysed_games a
            LEFT JOIN users u ON u.username_lower = a.username_lower
            GROUP BY a.username_lower
            ORDER BY games_analysed DESC
            """
        ).fetchall()

    return [dict(row) for row in rows]


@router.get("/queue-status")
def queue_status(_admin: dict = Depends(require_admin)) -> dict:
    """Return the background analysis queue's live status.

    Args:
        _admin: Injected admin guard.
    """
    return get_queue_status()
