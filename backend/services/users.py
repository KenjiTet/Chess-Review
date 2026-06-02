"""User management — reads and writes users.json in plaintext (v1)."""

import json
import os
from datetime import datetime, timezone

USERS_FILE: str = os.path.join(os.path.dirname(__file__), "..", "users.json")


def load_users() -> dict:
    """Load the users dict from disk. Returns {} if missing or corrupt."""
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_users(users: dict) -> None:
    """Persist the users dict to disk."""
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, indent=2)


def user_exists(username: str) -> bool:
    """Return True if the username is already registered."""
    users = load_users()
    return username.lower() in users


def create_user(username: str, password: str) -> None:
    """Register a new user. Raises ValueError if the username is taken."""
    users = load_users()
    key = username.lower()

    if key in users:
        raise ValueError(f"Username '{username}' is already taken.")

    users[key] = {
        "username": username,
        "password": password,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    save_users(users)


def check_password(username: str, password: str) -> bool:
    """Return True if the username exists and the password matches."""
    users = load_users()
    key = username.lower()

    if key not in users:
        return False

    return users[key]["password"] == password
