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
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_reviewed_games (
                username_lower TEXT NOT NULL,
                game_url       TEXT NOT NULL,
                reviewed_at    TEXT NOT NULL,
                PRIMARY KEY (username_lower, game_url)
            )
        """)

        # Per-user record of every analysed game. Source of truth for the
        # avg-blunders stat and for the background queue's "already analysed" set.
        # handle records which linked platform username the games belong to, so an
        # account that re-links a different handle keeps separate, non-colliding
        # stats instead of mixing both handles' games together.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_analysed_games (
                username_lower TEXT NOT NULL,
                game_url       TEXT NOT NULL,
                platform       TEXT NOT NULL,
                handle         TEXT,
                time_class     TEXT NOT NULL,
                player_color   TEXT NOT NULL,
                result         TEXT NOT NULL,
                blunder_count  INTEGER NOT NULL,
                end_time       INTEGER NOT NULL,
                analysed_at    TEXT NOT NULL,
                PRIMARY KEY (username_lower, game_url)
            )
        """)

        # Forward migration: link columns were added after the users table shipped.
        # CREATE TABLE IF NOT EXISTS won't alter an existing table, so add them here.
        _add_users_link_columns(conn)

        # Forward migration: positions_drilled tracks how many blunder positions
        # the user actually stepped through per game (added after the table shipped).
        _add_reviewed_drilled_column(conn)

        # Forward migration: the handle column scopes analysed-game rows to the
        # linked platform username (added after the table shipped).
        _add_analysed_handle_column(conn)

        # Forward migration: categories_per_blunder stores the engine-derived
        # blunder type per move_index (added after the cache table shipped).
        _add_cache_categories_column(conn)

        conn.commit()


def _add_users_link_columns(conn: sqlite3.Connection) -> None:
    """Add the chesscom_username / lichess_username columns to users if missing.

    Idempotent: inspects PRAGMA table_info and only adds columns that are absent,
    so it is safe to run on every startup.

    Args:
        conn: An open SQLite connection.
    """
    existing: set[str] = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(users)").fetchall()
    }

    if "chesscom_username" not in existing:
        conn.execute("ALTER TABLE users ADD COLUMN chesscom_username TEXT")

    if "lichess_username" not in existing:
        conn.execute("ALTER TABLE users ADD COLUMN lichess_username TEXT")

    # is_admin gates access to the admin dashboard. Stored on the row so admin
    # rights are data-driven and persist, rather than living only in an env var.
    if "is_admin" not in existing:
        conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")


def _add_reviewed_drilled_column(conn: sqlite3.Connection) -> None:
    """Add the positions_drilled column to user_reviewed_games if missing.

    Idempotent: inspects PRAGMA table_info and only adds the column when absent,
    so it is safe to run on every startup. Records how many blunder positions the
    user actually stepped through for each reviewed game.

    Args:
        conn: An open SQLite connection.
    """
    existing: set[str] = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(user_reviewed_games)").fetchall()
    }

    if "positions_drilled" not in existing:
        conn.execute(
            "ALTER TABLE user_reviewed_games ADD COLUMN positions_drilled INTEGER NOT NULL DEFAULT 0"
        )


def _add_cache_categories_column(conn: sqlite3.Connection) -> None:
    """Add the categories_per_blunder column to game_cache if missing.

    Idempotent: inspects PRAGMA table_info and only adds the column when absent,
    so it is safe to run on every startup. Stores a JSON map {move_index -> category}
    of engine-derived blunder types. Legacy rows default to an empty object and are
    backfilled the next time the game is analysed.

    Args:
        conn: An open SQLite connection.
    """
    existing: set[str] = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(game_cache)").fetchall()
    }

    if "categories_per_blunder" not in existing:
        conn.execute(
            "ALTER TABLE game_cache ADD COLUMN categories_per_blunder TEXT NOT NULL DEFAULT '{}'"
        )


def _add_analysed_handle_column(conn: sqlite3.Connection) -> None:
    """Add the handle column to user_analysed_games if missing, and backfill it.

    Idempotent: only adds the column when absent. Existing rows are seeded with the
    account's currently-linked handle for the row's platform (falling back to the
    account username), a best-effort guess so legacy rows still match the current
    handle's stats. New rows always store their true handle at analysis time.

    Args:
        conn: An open SQLite connection.
    """
    existing: set[str] = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(user_analysed_games)").fetchall()
    }

    if "handle" in existing:
        return

    conn.execute("ALTER TABLE user_analysed_games ADD COLUMN handle TEXT")

    # Seed legacy rows from the users table's current linkage, per platform.
    conn.execute(
        """
        UPDATE user_analysed_games
        SET handle = (
            SELECT COALESCE(u.chesscom_username, u.username)
            FROM users u
            WHERE u.username_lower = user_analysed_games.username_lower
        )
        WHERE platform = 'chesscom' AND handle IS NULL
        """
    )
    conn.execute(
        """
        UPDATE user_analysed_games
        SET handle = (
            SELECT u.lichess_username
            FROM users u
            WHERE u.username_lower = user_analysed_games.username_lower
        )
        WHERE platform = 'lichess' AND handle IS NULL
        """
    )
