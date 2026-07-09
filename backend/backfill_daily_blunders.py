"""One-off backfill for the Blunder of the Day history.

Computes and stores a daily puzzle for every day in a range that has none yet,
so the history list is populated instead of starting empty. Safe to re-run —
days that already have a stored puzzle are skipped.

Run from the backend directory with the analysis conda env active:

    python backfill_daily_blunders.py 2026-07-05
    python backfill_daily_blunders.py 2026-07-05 2026-07-09
    python backfill_daily_blunders.py 2026-07-05 2026-07-09 --reset

Pass --reset to delete any already-stored puzzles in the range first, so days
previously filled with duplicate games are rebuilt with distinct players/games.

Requires the same environment as the API (STOCKFISH_PATH in .env, network
access to Chess.com). Each fresh day runs Stockfish, so this can take a while.
"""

import sys
from datetime import date

from services import blunder_of_day
from services.db import get_connection, init_db


def _reset_range(start: str, end: str) -> int:
    """Delete stored daily puzzles in [start, end] so they can be rebuilt.

    Args:
        start: ISO date string of the first day to delete (inclusive).
        end: ISO date string of the last day to delete (inclusive).

    Returns:
        The number of rows deleted.
    """
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM blunder_of_day WHERE day >= ? AND day <= ?",
            (start, end),
        )
        conn.commit()
        return cursor.rowcount


def main() -> None:
    """Parse the start (and optional end) date and run the backfill."""
    args: list[str] = [arg for arg in sys.argv[1:] if arg != "--reset"]
    reset: bool = "--reset" in sys.argv

    # Default start is the launch date of the feature's history.
    if len(args) >= 1:
        start: str = args[0]
    else:
        start = "2026-07-05"

    if len(args) >= 2:
        end: str = args[1]
    else:
        end = date.today().isoformat()

    # Ensure the blunder_of_day table exists before writing to it.
    init_db()

    if reset:
        deleted: int = _reset_range(start, end)
        print(f"Reset: deleted {deleted} existing puzzle(s) in {start}..{end}.")

    print(f"Backfilling daily blunders from {start} to {end}…")
    results: dict[str, bool] = blunder_of_day.backfill(start, end)

    for day, stored in sorted(results.items()):
        status: str = "stored" if stored else "no qualifying blunder found"
        print(f"  {day}: {status}")

    print("Backfill complete.")


if __name__ == "__main__":
    main()
