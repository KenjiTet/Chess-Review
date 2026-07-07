"""Single-use, expiring tokens for email confirmation and password reset.

A token row is created when a confirmation/reset link is issued and marked used
the instant it is redeemed, so a link can never be replayed. Tokens also carry an
expiry so an old, un-clicked link stops working after its TTL.
"""

import secrets
from datetime import datetime, timedelta, timezone

from services.db import get_connection

# Default lifetimes per purpose. Confirmation links can live longer since they
# are lower-risk; reset links are shorter to limit the window of misuse.
_CONFIRM_TTL_HOURS: int = 48
_RESET_TTL_HOURS: int = 2


def _ttl_hours_for(purpose: str) -> int:
    """Return the token lifetime in hours for the given purpose."""
    if purpose == "reset":
        return _RESET_TTL_HOURS

    return _CONFIRM_TTL_HOURS


def create_token_row(username: str, purpose: str) -> str:
    """Create and persist a fresh single-use token, returning its value.

    Args:
        username: Account username the token belongs to (stored lowercased).
        purpose: Either "confirm" or "reset".

    Returns:
        The opaque URL-safe token string to embed in the email link.
    """
    token: str = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=_ttl_hours_for(purpose))

    with get_connection() as conn:
        conn.execute(
            "INSERT INTO auth_tokens (token, username_lower, purpose, expires_at, used, created_at) VALUES (?, ?, ?, ?, 0, ?)",
            (token, username.lower(), purpose, expires_at.isoformat(), now.isoformat()),
        )
        conn.commit()

    return token


def consume_token(token: str, purpose: str) -> str | None:
    """Validate and burn a token, returning the owning username on success.

    A token is valid only when it exists, matches the expected purpose, has not
    already been used, and has not expired. On success it is marked used in the
    same transaction so it cannot be redeemed twice.

    Args:
        token: The token value from the link.
        purpose: The expected purpose ("confirm" or "reset").

    Returns:
        The owning account's username_lower, or None if the token is invalid,
        expired, already used, or of the wrong purpose.
    """
    with get_connection() as conn:
        row = conn.execute(
            "SELECT username_lower, purpose, expires_at, used FROM auth_tokens WHERE token = ?",
            (token,),
        ).fetchone()

        if row is None:
            return None

        if row["purpose"] != purpose:
            return None

        if bool(row["used"]):
            return None

        # Reject expired tokens.
        expires_at = datetime.fromisoformat(row["expires_at"])
        if datetime.now(timezone.utc) >= expires_at:
            return None

        # Burn the token atomically so it can only ever be used once.
        conn.execute("UPDATE auth_tokens SET used = 1 WHERE token = ?", (token,))
        conn.commit()

    return row["username_lower"]
