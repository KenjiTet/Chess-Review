"""Games router — fetch games from Chess.com and expose game history with cache data."""

from datetime import datetime, timezone

import requests as req_lib
from fastapi import APIRouter, HTTPException

from models import GameAnalysisResult, GameHistoryEntry
from services.cache import get_cached_game, is_cached, store_game
from services.chess_com import get_game_by_url, get_recent_games, get_recent_games_all
from services.stockfish import DEPTH, analyze_game, find_blunders, get_board_snapshots

router = APIRouter()

# Chess.com result values that indicate a draw.
_DRAW_RESULTS: frozenset[str] = frozenset({
    "stalemate", "agreed", "repetition", "insufficient",
    "timevsinsufficient", "50move",
})


def _player_result(game: dict, username: str) -> str:
    """Determine the game result ("win" | "lose" | "draw") from the player's perspective."""
    white: dict = game.get("white", {})
    black: dict = game.get("black", {})

    if white.get("username", "").lower() == username.lower():
        side_result: str = white.get("result", "")
    else:
        side_result = black.get("result", "")

    if side_result == "win":
        return "win"

    if side_result in _DRAW_RESULTS:
        return "draw"

    return "lose"


def _iso_date(end_time: int) -> str:
    """Convert a Unix timestamp to an ISO 8601 date string (UTC)."""
    return datetime.fromtimestamp(end_time, tz=timezone.utc).isoformat()


def _blunder_data_from_cache(cache: dict, game_url: str, threshold: int) -> tuple[int | None, str | None, str | None]:
    """Return (blunder_count, first_blunder_fen, first_blunder_color) from cache.

    Returns (None, None, None) if the game is not in cache.
    """
    if not is_cached(cache, game_url, DEPTH):
        return None, None, None

    entry: dict = get_cached_game(cache, game_url)
    move_data: list[dict] = entry.get("move_data", [])
    fens: list[str] = entry.get("fens", [])

    blunders: list[dict] = find_blunders(move_data, min_cp_loss=threshold)

    blunder_count: int = len(blunders)

    if blunders and fens:
        first_idx: int = blunders[0]["move_index"]
        first_fen: str | None = fens[first_idx] if first_idx < len(fens) else None
        first_color: str | None = blunders[0].get("color")
    else:
        first_fen = None
        first_color = None

    return blunder_count, first_fen, first_color


@router.get("")
def list_games(username: str, time_class: str, n: int) -> list[dict]:
    """Fetch the n most recent games of a given time class for a player.

    Args (query params):
        username:   Chess.com username.
        time_class: One of rapid, blitz, bullet, daily.
        n:          Number of games to fetch.

    Returns:
        List of game dicts (pgn, url, white, black, time_class, etc.)

    Raises:
        404 if the username is not found on Chess.com.
        502 on Chess.com network/API errors.
    """
    try:
        games = get_recent_games(username, time_class, n)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except req_lib.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Chess.com API error: {exc}")

    return games


@router.get("/history")
def game_history(
    username: str,
    time_class: str,
    n: int,
    offset: int,
    threshold: int,
    is_guest: bool = False,
) -> list[GameHistoryEntry]:
    """Fetch enriched game history for the player with blunder data from cache.

    Args (query params):
        username:   Chess.com username.
        time_class: Time class filter. Use "all" to include all time classes.
        n:          Number of entries to return.
        offset:     Number of entries to skip (for "load more" pagination).
        threshold:  Blunder threshold in centipawns (used to count blunders from cache).

    Returns:
        List of GameHistoryEntry, enriched with blunder data where the game is cached.
    """
    total_needed: int = offset + n

    try:
        if time_class == "all":
            games = get_recent_games_all(username, total_needed)
        else:
            games = get_recent_games(username, time_class, total_needed)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except req_lib.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Chess.com API error: {exc}")

    paginated: list[dict] = games[offset:offset + n]
    # cache stub: functions use SQLite directly and ignore this arg.
    cache: dict = {}
    entries: list[GameHistoryEntry] = []

    for game in paginated:
        url: str = game.get("url", "")
        end_time: int = game.get("end_time", 0)
        white: dict = game.get("white", {})
        black: dict = game.get("black", {})

        if is_guest:
            blunder_count, first_fen, first_color = None, None, None
        else:
            blunder_count, first_fen, first_color = _blunder_data_from_cache(cache, url, threshold)

        accuracies: dict = game.get("accuracies", {})

        entries.append(GameHistoryEntry(
            url=url,
            date=_iso_date(end_time),
            result=_player_result(game, username),
            time_class=game.get("time_class", time_class),
            white_username=white.get("username", ""),
            black_username=black.get("username", ""),
            white_accuracy=accuracies.get("white"),
            black_accuracy=accuracies.get("black"),
            blunder_count=blunder_count,
            first_blunder_fen=first_fen,
            first_blunder_color=first_color,
        ))

    return entries


@router.get("/analyze")
def analyze_game_history(
    game_url: str,
    username: str,
    threshold: int,
    is_guest: bool = False,
) -> GameAnalysisResult:
    """Analyze a single game and return its blunder count and first blunder position.

    Checks the disk cache first (unless is_guest=True). On a cache miss, fetches the
    game PGN from Chess.com and runs Stockfish analysis. Results are persisted to cache
    unless is_guest=True.

    Args (query params):
        game_url:  Chess.com game URL.
        username:  Chess.com username (needed to locate the game in archives).
        threshold: Minimum centipawn loss to count as a blunder.
        is_guest:  When True, skip reading from and writing to the disk cache.

    Returns:
        GameAnalysisResult with blunder_count and optional first_blunder_fen/color.

    Raises:
        404 if the game is not found on Chess.com.
        502 on Chess.com network errors.
    """
    # cache stub: functions use SQLite directly and ignore this arg.
    cache: dict = {}

    # Fast path: return cached blunder data immediately.
    if not is_guest and is_cached(cache, game_url, DEPTH):
        blunder_count, first_fen, first_color = _blunder_data_from_cache(cache, game_url, threshold)
        return GameAnalysisResult(
            blunder_count=blunder_count or 0,
            first_blunder_fen=first_fen,
            first_blunder_color=first_color,
        )

    # Fetch game PGN from Chess.com.
    try:
        game: dict = get_game_by_url(username, game_url)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except req_lib.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Chess.com API error: {exc}")

    pgn: str = game.get("pgn", "")
    if not pgn:
        raise HTTPException(status_code=404, detail="Game PGN not found.")

    # Run Stockfish analysis.
    move_data: list[dict] = analyze_game(pgn)
    fens: list[str]
    uci_moves: list[str]
    fens, uci_moves = get_board_snapshots(pgn)
    blunders: list[dict] = find_blunders(move_data, min_cp_loss=threshold)

    blunder_count: int = len(blunders)
    first_fen: str | None = None
    first_color: str | None = None

    if blunders and fens:
        first_idx: int = blunders[0]["move_index"]
        first_fen = fens[first_idx] if first_idx < len(fens) else None
        first_color = blunders[0].get("color")

    # Persist to cache unless this is a guest session.
    if not is_guest:
        store_game(cache, game_url, pgn, move_data, fens, uci_moves, {}, DEPTH)

    return GameAnalysisResult(
        blunder_count=blunder_count,
        first_blunder_fen=first_fen,
        first_blunder_color=first_color,
    )
