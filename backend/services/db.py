"""SQLite connection and schema initialisation.

DATABASE_PATH env var controls the file location.
Defaults to cache/app.db for local dev (same folder the old JSON cache used).
"""

import os
import sqlite3

# Default keeps local dev working without any env var changes.
_DB_PATH: str = os.getenv(
    "DATABASE_PATH",
    os.path.join(os.path.dirname(__file__), "..", "cache", "app.db"),
)


def get_connection() -> sqlite3.Connection:
    """Return an open SQLite connection with row_factory set."""
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Create tables if they do not already exist. Safe to call on every startup."""
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS game_cache (
                url                    TEXT PRIMARY KEY,
                pgn                    TEXT NOT NULL,
                move_data              TEXT NOT NULL,
                fens                   TEXT NOT NULL,
                uci_moves              TEXT NOT NULL,
                best_moves_per_blunder TEXT NOT NULL,
                analysed_at            TEXT NOT NULL,
                depth                  INTEGER NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                username_lower TEXT PRIMARY KEY,
                username       TEXT NOT NULL,
                password_hash  TEXT NOT NULL,
                created_at     TEXT NOT NULL
            )
        """)
        conn.commit()
