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


def create_user(
    username: str,
    password: str,
    chesscom_username: str | None = None,
    lichess_username: str | None = None,
) -> None:
    """Register a new user. Raises ValueError if the username is taken.

    The account username is the login identity and is independent of the linked
    platform handles. At least one linked platform username should normally be
    provided so the account knows whose games to fetch.

    Args:
        username: Display username (case-preserved) used for login.
        password: Plaintext password — stored as a bcrypt hash.
        chesscom_username: Linked Chess.com handle, if any.
        lichess_username: Linked Lichess handle, if any.
    """
    if user_exists(username):
        raise ValueError(f"Username '{username}' is already taken.")

    password_hash: str = bcrypt.hashpw(
        password.encode(), bcrypt.gensalt()
    ).decode()

    with get_connection() as conn:
        conn.execute(
            "INSERT INTO users (username_lower, username, password_hash, created_at, chesscom_username, lichess_username) VALUES (?, ?, ?, ?, ?, ?)",
            (
                username.lower(),
                username,
                password_hash,
                datetime.now(timezone.utc).isoformat(),
                chesscom_username,
                lichess_username,
            ),
        )
        conn.commit()


def get_user(username: str) -> dict | None:
    """Return the account row for a username, or None if it does not exist.

    Args:
        username: Account username to look up (case-insensitive).

    Returns:
        Dict with username, chesscom_username, lichess_username, created_at — or None.
    """
    with get_connection() as conn:
        row = conn.execute(
            "SELECT username, chesscom_username, lichess_username, created_at, is_admin FROM users WHERE username_lower = ?",
            (username.lower(),),
        ).fetchone()

    if row is None:
        return None

    return {
        "username": row["username"],
        "chesscom_username": row["chesscom_username"],
        "lichess_username": row["lichess_username"],
        "created_at": row["created_at"],
        "is_admin": bool(row["is_admin"]),
    }


def record_login(username: str) -> None:
    """Stamp the account's last_login with the current UTC time.

    Args:
        username: Account username to update (case-insensitive).
    """
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET last_login = ? WHERE username_lower = ?",
            (datetime.now(timezone.utc).isoformat(), username.lower()),
        )
        conn.commit()


def is_admin(username: str) -> bool:
    """Return True if the account is flagged as an admin in the database.

    Args:
        username: Account username to check (case-insensitive).
    """
    with get_connection() as conn:
        row = conn.execute(
            "SELECT is_admin FROM users WHERE username_lower = ?",
            (username.lower(),),
        ).fetchone()

    if row is None:
        return False

    return bool(row["is_admin"])


def set_admin(username: str, admin: bool) -> None:
    """Grant or revoke admin rights for an existing account.

    Args:
        username: Account username to update (case-insensitive).
        admin: True to grant admin rights, False to revoke.
    """
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET is_admin = ? WHERE username_lower = ?",
            (1 if admin else 0, username.lower()),
        )
        conn.commit()


def set_linked_accounts(
    username: str,
    chesscom_username: str | None = None,
    lichess_username: str | None = None,
) -> None:
    """Link or update a platform handle for an existing account.

    Only the platform(s) passed as non-None are updated, so linking Lichess later
    does not clear a previously linked Chess.com handle.

    Args:
        username: Account username to update.
        chesscom_username: New Chess.com handle, or None to leave unchanged.
        lichess_username: New Lichess handle, or None to leave unchanged.
    """
    with get_connection() as conn:
        if chesscom_username is not None:
            conn.execute(
                "UPDATE users SET chesscom_username = ? WHERE username_lower = ?",
                (chesscom_username, username.lower()),
            )

        if lichess_username is not None:
            conn.execute(
                "UPDATE users SET lichess_username = ? WHERE username_lower = ?",
                (lichess_username, username.lower()),
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
