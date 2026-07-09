"""Blunder of the Day router — serves the precomputed daily puzzle."""

from datetime import date

from fastapi import APIRouter, HTTPException

from models import BlunderResponse, DailyBlunderHistoryItem
from services import blunder_of_day as blunder_of_day_service

router = APIRouter()


@router.get("/history")
def get_blunder_of_day_history(limit: int = 30) -> list[DailyBlunderHistoryItem]:
    """Return the most recent daily puzzles for the history list.

    Reads only precomputed rows — it never triggers Stockfish analysis. Newest
    day first; an empty list on a cold start before anything has been computed.
    """
    history: list[dict] = blunder_of_day_service.get_history(limit)

    return [
        DailyBlunderHistoryItem(day=item["day"], blunder=BlunderResponse(**item["blunder"]))
        for item in history
    ]


@router.get("/")
def get_blunder_of_day() -> BlunderResponse:
    """Return today's blunder-of-the-day puzzle.

    The daily background worker precomputes and stores the puzzle, so this route
    only reads from the database — it never triggers Stockfish analysis. If today's
    puzzle isn't ready yet, the most recent stored one is returned so the page is
    never empty; a 404 is raised only on a cold start when nothing has been
    computed at all.
    """
    day: str = date.today().isoformat()

    # Prefer today's puzzle; fall back to the latest available while the worker
    # is still computing a fresh one.
    blunder: dict | None = blunder_of_day_service.get_today(day)

    if blunder is None:
        blunder = blunder_of_day_service.get_latest()

    if blunder is None:
        raise HTTPException(status_code=404, detail="No blunder of the day is available yet.")

    # Extra keys (e.g. game_index) are ignored by the model.
    return BlunderResponse(**blunder)
