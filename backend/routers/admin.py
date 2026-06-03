"""Admin router — live DB inspection endpoints, restricted to admin users only."""

from fastapi import APIRouter, Depends

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
            "SELECT username, username_lower, created_at FROM users ORDER BY created_at DESC"
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
    return {"total_users": user_count, "total_cached_games": cache_count}
