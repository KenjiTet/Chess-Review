"""User management — SQLite-backed with bcrypt password hashing.

Login identity is the email address; the internal `username` (primary key and
per-user namespace) is derived from the email local-part and stays stable for the
life of the account. A migration path is kept for pre-hashing accounts: a stored
value that doesn't look like a bcrypt hash is treated as plaintext, verified
directly, then re-hashed in place.
"""

import re

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


def email_exists(email: str) -> bool:
    """Return True if the email address is already registered."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT 1 FROM users WHERE email = ?", (email.lower(),)
        ).fetchone()
    return row is not None


def _derive_username(email: str) -> str:
    """Derive a stable, unique internal username from an email address.

    Takes the local-part (before the @), strips it down to safe characters, and
    appends a numeric suffix if that base is already taken.

    Args:
        email: The account email address.

    Returns:
        A username that is not currently present in the users table.
    """
    local_part: str = email.split("@", 1)[0]
    # Keep only alphanumerics, dot, underscore and hyphen; collapse anything else.
    base: str = re.sub(r"[^A-Za-z0-9._-]", "", local_part)

    if not base:
        base = "user"

    candidate: str = base
    suffix: int = 1

    # Append an incrementing suffix until the username is free.
    while user_exists(candidate):
        suffix += 1
        candidate = f"{base}{suffix}"

    return candidate


def create_user(
    email: str,
    password: str,
    chesscom_username: str | None = None,
    lichess_username: str | None = None,
    auth_provider: str = "password",
) -> str:
    """Register a new user keyed by email. Raises ValueError if the email is taken.

    The internal username is derived from the email local-part and returned so the
    caller can mint a JWT for it. Google accounts pass an empty password and
    auth_provider="google"; their email is treated as pre-verified by the caller.

    Args:
        email: Login identity — stored lowercased and must be unique.
        password: Plaintext password (empty for OAuth accounts) — stored as a bcrypt hash.
        chesscom_username: Linked Chess.com handle, if any.
        lichess_username: Linked Lichess handle, if any.
        auth_provider: "password" or "google".

    Returns:
        The generated internal username.
    """
    normalized_email: str = email.lower()

    if email_exists(normalized_email):
        raise ValueError("An account with this email already exists.")

    username: str = _derive_username(normalized_email)

    # OAuth accounts have no password; store an empty hash and gate login on provider.
    password_hash: str = ""
    if password:
        password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    # Google emails are verified by Google; password signups must confirm via email.
    email_verified: int = 1 if auth_provider == "google" else 0

    with get_connection() as conn:
        conn.execute(
            "INSERT INTO users (username_lower, username, password_hash, created_at, chesscom_username, lichess_username, email, email_verified, auth_provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                username.lower(),
                username,
                password_hash,
                datetime.now(timezone.utc).isoformat(),
                chesscom_username,
                lichess_username,
                normalized_email,
                email_verified,
                auth_provider,
            ),
        )
        conn.commit()

    return username


def get_user(username: str) -> dict | None:
    """Return the account row for a username, or None if it does not exist.

    Args:
        username: Account username to look up (case-insensitive).

    Returns:
        Dict with account fields, or None.
    """
    with get_connection() as conn:
        row = conn.execute(
            "SELECT username, chesscom_username, lichess_username, created_at, is_admin, email, email_verified, auth_provider FROM users WHERE username_lower = ?",
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
        "email": row["email"],
        "email_verified": bool(row["email_verified"]),
        "auth_provider": row["auth_provider"],
    }


def get_user_by_email(email: str) -> dict | None:
    """Return the account row for an email address, or None if not found.

    Args:
        email: Login email to look up (case-insensitive).

    Returns:
        Dict with username, auth_provider, email_verified, and linked handles — or None.
    """
    with get_connection() as conn:
        row = conn.execute(
            "SELECT username, chesscom_username, lichess_username, email_verified, auth_provider FROM users WHERE email = ?",
            (email.lower(),),
        ).fetchone()

    if row is None:
        return None

    return {
        "username": row["username"],
        "chesscom_username": row["chesscom_username"],
        "lichess_username": row["lichess_username"],
        "email_verified": bool(row["email_verified"]),
        "auth_provider": row["auth_provider"],
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


def is_email_verified(username: str) -> bool:
    """Return True if the account's email has been confirmed.

    Args:
        username: Account username to check (case-insensitive).
    """
    with get_connection() as conn:
        row = conn.execute(
            "SELECT email_verified FROM users WHERE username_lower = ?",
            (username.lower(),),
        ).fetchone()

    if row is None:
        return False

    return bool(row["email_verified"])


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


def set_user_email(username: str, email: str) -> None:
    """Set (or change) an account's email and mark it unconfirmed.

    Used by legacy username-only accounts adding an email, and by anyone changing
    theirs. The caller is responsible for uniqueness checks and sending a fresh
    confirmation email.

    Args:
        username: Account username to update (case-insensitive).
        email: New email address — stored lowercased. Confirmation is reset to 0.
    """
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET email = ?, email_verified = 0 WHERE username_lower = ?",
            (email.lower(), username.lower()),
        )
        conn.commit()


def set_email_verified(username: str) -> None:
    """Mark the account's email as confirmed.

    Args:
        username: Account username to update (case-insensitive).
    """
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET email_verified = 1 WHERE username_lower = ?",
            (username.lower(),),
        )
        conn.commit()


def set_password(username: str, new_password: str) -> None:
    """Replace the account's password with a fresh bcrypt hash.

    Args:
        username: Account username to update (case-insensitive).
        new_password: New plaintext password — stored hashed.
    """
    new_hash: str = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()

    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE username_lower = ?",
            (new_hash, username.lower()),
        )
        conn.commit()


def delete_user(username: str) -> None:
    """Permanently delete an account and all of its associated data.

    Removes the user's rows across every per-user table plus any outstanding
    auth tokens, then the account row itself.

    Args:
        username: Account username to delete (case-insensitive).
    """
    key: str = username.lower()

    with get_connection() as conn:
        conn.execute("DELETE FROM user_reviewed_games WHERE username_lower = ?", (key,))
        conn.execute("DELETE FROM user_analysed_games WHERE username_lower = ?", (key,))
        conn.execute("DELETE FROM user_stats_cache WHERE username_lower = ?", (key,))
        conn.execute("DELETE FROM auth_tokens WHERE username_lower = ?", (key,))
        conn.execute("DELETE FROM users WHERE username_lower = ?", (key,))
        conn.commit()


def get_or_create_google_user(email: str) -> tuple[str, bool]:
    """Return the username for a Google email, creating the account if needed.

    Args:
        email: Verified email address from the Google ID token.

    Returns:
        Tuple of (username, needs_link) where needs_link is True when the account
        has no linked Chess.com/Lichess handle yet and must complete linking.
    """
    existing = get_user_by_email(email)

    if existing is not None:
        needs_link: bool = (
            existing["chesscom_username"] is None and existing["lichess_username"] is None
        )
        return existing["username"], needs_link

    # First Google sign-in for this email: create a verified, password-less account.
    username: str = create_user(email, "", auth_provider="google")

    # Brand-new Google account has no platform handle yet, so it must link one.
    return username, True


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

    Google (OAuth) accounts have no password and always fail password login.
    Handles legacy plaintext passwords: if the stored value is not a bcrypt hash
    it is compared directly, then re-hashed and updated so future logins use bcrypt.

    Args:
        username: Username to look up.
        password: Plaintext password to verify.
    """
    with get_connection() as conn:
        row = conn.execute(
            "SELECT password_hash, auth_provider FROM users WHERE username_lower = ?",
            (username.lower(),),
        ).fetchone()

    if row is None:
        return False

    # OAuth accounts (empty hash) cannot authenticate with a password.
    if row["auth_provider"] == "google" or not row["password_hash"]:
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
