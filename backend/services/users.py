"""User management — SQLite-backed with bcrypt password hashing.

Includes a migration path for accounts created before hashing was introduced:
if a stored hash doesn't look like a bcrypt hash it is treated as plaintext,
verified directly, then re-hashed and updated in place.
"""

import bcrypt
from datetime import datetime, timezone

from services.db import get_connection


def _is_bcrypt_hash(value: str) -> bool:
    """Return True if the value looks like a bcrypt hash."""
    return value.startswith("$2b$") or value.startswith("$2a$")


def user_exists(username: str) -> bool:
    """Return True if the username is already registered."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT 1 FROM users WHERE username_lower = ?", (username.lower(),)
        ).fetchone()
    return row is not None


def create_user(username: str, password: str) -> None:
    """Register a new user. Raises ValueError if the username is taken.

    Args:
        username: Display username (case-preserved).
        password: Plaintext password — stored as a bcrypt hash.
    """
    if user_exists(username):
        raise ValueError(f"Username '{username}' is already taken.")

    password_hash: str = bcrypt.hashpw(
        password.encode(), bcrypt.gensalt()
    ).decode()

    with get_connection() as conn:
        conn.execute(
            "INSERT INTO users (username_lower, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (
                username.lower(),
                username,
                password_hash,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        conn.commit()


def check_password(username: str, password: str) -> bool:
    """Return True if the username exists and the password matches.

    Handles legacy plaintext passwords: if the stored value is not a bcrypt
    hash, it is compared directly. On a successful match the value is
    re-hashed and the row is updated so future logins use bcrypt.

    Args:
        username: Username to look up.
        password: Plaintext password to verify.
    """
    with get_connection() as conn:
        row = conn.execute(
            "SELECT password_hash FROM users WHERE username_lower = ?",
            (username.lower(),),
        ).fetchone()

    if row is None:
        return False

    stored: str = row["password_hash"]

    if _is_bcrypt_hash(stored):
        return bcrypt.checkpw(password.encode(), stored.encode())

    # Legacy plaintext path — verify then upgrade to bcrypt.
    if stored != password:
        return False

    new_hash: str = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE username_lower = ?",
            (new_hash, username.lower()),
        )
        conn.commit()

    return True
