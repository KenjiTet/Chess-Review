"""Games router — fetch games from Chess.com and expose game history with cache data."""

from datetime import datetime, timezone

import requests as req_lib
from fastapi import APIRouter, Depends, HTTPException

from models import GameAnalysisResult, GameHistoryEntry
from services.analysis_store import analyse_and_store
from services.jwt_service import get_optional_user
from services.cache import get_cached_game, is_cached, store_game
from services.chess_com import get_game_by_url as chesscom_game_by_url
from services.chess_com import get_recent_games as chesscom_recent_games
from services.chess_com import get_recent_games_all as chesscom_recent_games_all
import services.lichess as lichess_svc
from services.categorize import UNCATEGORIZED, categorize_from_eval, derive_mover_evals, resolve_category
from services.stockfish import DEPTH, analyze_game, compute_player_accuracy, find_blunders, get_best_moves, get_board_snapshots

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


def _category_breakdown(
    blunders: list[dict],
    move_data: list[dict],
    categories_per_blunder: dict[str, str],
) -> dict[str, int]:
    """Tally the player's blunders by category, reading stored categories from cache.

    For blunders without a stored category (legacy games analysed before the
    feature shipped), fall back to eval-only categorisation (mate cases only);
    anything else buckets as 'uncategorized' until the game is re-analysed.

    Args:
        blunders: The player's blunder dicts (each carries move_index).
        move_data: Output of analyze_game() for the eval-only fallback.
        categories_per_blunder: Cached {move_index (str) -> category} map.
    """
    counts: dict[str, int] = {}

    for blunder in blunders:
        move_index: int = blunder["move_index"]
        category: str | None = categories_per_blunder.get(str(move_index))

        if category is None:
            # Legacy game: recover mate categories from eval, else uncategorized.
            eval_before_mover, eval_after_mover = derive_mover_evals(move_data, move_index)
            category = categorize_from_eval(eval_before_mover, eval_after_mover) or UNCATEGORIZED

        counts[category] = counts.get(category, 0) + 1

    return counts


def _backfill_categories(game_url: str, threshold: int, player_color: str) -> None:
    """Compute and persist missing categories for a cached game's player blunders.

    No-op when the game is not cached or every player blunder already has a stored
    category. Runs the engine only for the blunders that are missing one, then
    updates the cache so subsequent reads (and the history list) are instant.

    Args:
        game_url: Game URL — key into game_cache.
        threshold: Blunder threshold in centipawns.
        player_color: "white" or "black" — only this side's blunders are filled.
    """
    cache: dict = {}

    if not is_cached(cache, game_url, DEPTH):
        return

    entry: dict = get_cached_game(cache, game_url)
    move_data: list[dict] = entry.get("move_data", [])
    fens: list[str] = entry.get("fens", [])
    uci_moves: list[str] = entry.get("uci_moves", [])
    pgn: str = entry.get("pgn", "")
    best_moves_per_blunder: dict[str, list[str]] = dict(entry.get("best_moves_per_blunder", {}))
    categories_per_blunder: dict[str, str] = dict(entry.get("categories_per_blunder", {}))

    blunders: list[dict] = find_blunders(move_data, min_cp_loss=threshold)
    blunders = [b for b in blunders if b.get("color") == player_color]

    changed: bool = False

    for blunder in blunders:
        move_index: int = blunder["move_index"]
        idx_str: str = str(move_index)

        if idx_str in categories_per_blunder:
            continue

        if idx_str not in best_moves_per_blunder:
            best_moves_per_blunder[idx_str] = get_best_moves(pgn, move_index, n_best=3)

        categories_per_blunder[idx_str] = resolve_category(move_data, fens, uci_moves, move_index, best_moves_per_blunder[idx_str])
        changed = True

    if changed:
        store_game(cache, game_url, pgn, move_data, fens, uci_moves, best_moves_per_blunder, DEPTH, categories_per_blunder)


def _blunder_data_from_cache(
    cache: dict,
    game_url: str,
    threshold: int,
    player_color: str | None = None,
) -> tuple[int | None, str | None, str | None, dict[str, float], dict[str, int]]:
    """Return (blunder_count, first_blunder_fen, first_blunder_color, computed_accuracy, categories) from cache.

    computed_accuracy is a dict {"white": float, "black": float} derived from Stockfish data.
    categories is a {category -> count} map for the player's blunders.
    Returns (None, None, None, {}, {}) if the game is not in cache.
    If player_color is provided, only blunders for that color are counted (matches trainer behaviour).
    """
    if not is_cached(cache, game_url, DEPTH):
        return None, None, None, {}, {}

    entry: dict = get_cached_game(cache, game_url)
    move_data: list[dict] = entry.get("move_data", [])
    fens: list[str] = entry.get("fens", [])
    categories_per_blunder: dict[str, str] = entry.get("categories_per_blunder", {})

    blunders: list[dict] = find_blunders(move_data, min_cp_loss=threshold)
    computed_acc: dict[str, float] = compute_player_accuracy(move_data)

    # Filter to the player's own blunders only, matching the trainer's behaviour.
    if player_color is not None:
        blunders = [b for b in blunders if b.get("color") == player_color]

    blunder_count: int = len(blunders)
    categories: dict[str, int] = _category_breakdown(blunders, move_data, categories_per_blunder)

    if blunders and fens:
        first_idx: int = blunders[0]["move_index"]
        first_fen: str | None = fens[first_idx] if first_idx < len(fens) else None
        first_color: str | None = blunders[0].get("color")
    else:
        first_fen = None
        first_color = None

    return blunder_count, first_fen, first_color, computed_acc, categories


def _resolve_accuracies(game: dict, computed_acc: dict[str, float]) -> tuple[float | None, float | None]:
    """Resolve per-player accuracy, preferring Chess.com's values over Stockfish-computed ones.

    Mirrors the logic in the history endpoint so on-demand analysis returns the
    same accuracy the list would show after a reload.
    """
    accuracies: dict = game.get("accuracies", {})

    chess_com_white: float | None = accuracies.get("white")
    chess_com_black: float | None = accuracies.get("black")

    if chess_com_white is not None:
        white_accuracy: float | None = chess_com_white
    else:
        white_accuracy = computed_acc.get("white")

    if chess_com_black is not None:
        black_accuracy: float | None = chess_com_black
    else:
        black_accuracy = computed_acc.get("black")

    return white_accuracy, black_accuracy


@router.get("")
def list_games(username: str, time_class: str, n: int, platform: str = "chesscom") -> list[dict]:
    """Fetch the n most recent games of a given time class for a player.

    Args (query params):
        username:   Player username.
        time_class: One of rapid, blitz, bullet, daily.
        n:          Number of games to fetch.
        platform:   "chesscom" or "lichess".

    Returns:
        List of game dicts (pgn, url, white, black, time_class, etc.)

    Raises:
        404 if the username is not found.
        502 on API network errors.
    """
    try:
        if platform == "lichess":
            games = lichess_svc.get_recent_games(username, time_class, n)
        else:
            games = chesscom_recent_games(username, time_class, n)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except req_lib.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"API error: {exc}")

    return games


@router.get("/history")
def game_history(
    username: str,
    time_class: str,
    n: int,
    offset: int,
    threshold: int,
    is_guest: bool = False,
    platform: str = "chesscom",
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
        if platform == "lichess":
            if time_class == "all":
                games = lichess_svc.get_recent_games_all(username, total_needed)
            else:
                games = lichess_svc.get_recent_games(username, time_class, total_needed)
        else:
            if time_class == "all":
                games = chesscom_recent_games_all(username, total_needed)
            else:
                games = chesscom_recent_games(username, time_class, total_needed)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except req_lib.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"API error: {exc}")

    paginated: list[dict] = games[offset:offset + n]
    # cache stub: functions use SQLite directly and ignore this arg.
    cache: dict = {}
    entries: list[GameHistoryEntry] = []

    for game in paginated:
        url: str = game.get("url", "")
        end_time: int = game.get("end_time", 0)
        white: dict = game.get("white", {})
        black: dict = game.get("black", {})

        computed_acc: dict[str, float] = {}

        # Determine which color the requesting player played so blunder counts match the trainer.
        if white.get("username", "").lower() == username.lower():
            player_color: str = "white"
        else:
            player_color = "black"

        blunder_categories: dict[str, int] = {}

        if is_guest:
            blunder_count, first_fen, first_color = None, None, None
        else:
            blunder_count, first_fen, first_color, computed_acc, blunder_categories = _blunder_data_from_cache(cache, url, threshold, player_color)

        accuracies: dict = game.get("accuracies", {})

        # Prefer Chess.com's accuracy values; fall back to Stockfish-computed values.
        chess_com_white: float | None = accuracies.get("white")
        chess_com_black: float | None = accuracies.get("black")

        if chess_com_white is not None:
            white_accuracy: float | None = chess_com_white
        else:
            white_accuracy = computed_acc.get("white")

        if chess_com_black is not None:
            black_accuracy: float | None = chess_com_black
        else:
            black_accuracy = computed_acc.get("black")

        entries.append(GameHistoryEntry(
            url=url,
            date=_iso_date(end_time),
            result=_player_result(game, username),
            time_class=game.get("time_class", time_class),
            white_username=white.get("username", ""),
            white_rating=white.get("rating"),
            black_username=black.get("username", ""),
            black_rating=black.get("rating"),
            white_accuracy=white_accuracy,
            black_accuracy=black_accuracy,
            blunder_count=blunder_count,
            first_blunder_fen=first_fen,
            first_blunder_color=first_color,
            blunder_categories=blunder_categories,
        ))

    return entries


@router.get("/analyze")
def analyze_game_history(
    game_url: str,
    username: str,
    threshold: int,
    is_guest: bool = False,
    platform: str = "chesscom",
    user: dict | None = Depends(get_optional_user),
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

    # Always fetch the game dict first — we need it to determine the player's color
    # so blunder counts match the trainer (which only shows the player's own blunders).
    try:
        if platform == "lichess":
            game: dict = lichess_svc.get_game_by_url(username, game_url)
        else:
            game = chesscom_game_by_url(username, game_url)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except req_lib.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"API error: {exc}")

    white_info: dict = game.get("white", {})
    if white_info.get("username", "").lower() == username.lower():
        player_color_analyze: str = "white"
    else:
        player_color_analyze = "black"

    # For logged-in users, ensure the game is analysed, cached, and recorded as a
    # per-user analysed game (drives DB-derived stats). The row is keyed by the
    # account name from the JWT, while colour is resolved from the platform handle
    # (the `username` query param). Guests (no token) are never persisted.
    if not is_guest and user is not None:
        analyse_and_store(user["sub"].lower(), platform, username, game)

    # Fast path: Stockfish data already cached — just re-filter by player color.
    if not is_guest and is_cached(cache, game_url, DEPTH):
        # Backfill categories for games cached before they were computed (one-time, engine only for missing).
        _backfill_categories(game_url, threshold, player_color_analyze)
        blunder_count, first_fen, first_color, computed_acc, blunder_categories = _blunder_data_from_cache(cache, game_url, threshold, player_color_analyze)
        white_accuracy, black_accuracy = _resolve_accuracies(game, computed_acc)
        return GameAnalysisResult(
            blunder_count=blunder_count or 0,
            first_blunder_fen=first_fen,
            first_blunder_color=first_color,
            white_accuracy=white_accuracy,
            black_accuracy=black_accuracy,
            blunder_categories=blunder_categories,
        )

    pgn: str = game.get("pgn", "")
    if not pgn:
        raise HTTPException(status_code=404, detail="Game PGN not found.")

    # Run Stockfish analysis.
    move_data: list[dict] = analyze_game(pgn)
    fens: list[str]
    uci_moves: list[str]
    fens, uci_moves = get_board_snapshots(pgn)
    computed_acc: dict[str, float] = compute_player_accuracy(move_data)
    blunders: list[dict] = find_blunders(move_data, min_cp_loss=threshold)

    # Only count the requesting player's blunders, matching the trainer's behaviour.
    blunders = [b for b in blunders if b.get("color") == player_color_analyze]
    blunder_count: int = len(blunders)
    first_fen: str | None = None
    first_color: str | None = None

    if blunders and fens:
        first_idx: int = blunders[0]["move_index"]
        first_fen = fens[first_idx] if first_idx < len(fens) else None
        first_color = blunders[0].get("color")

    # Compute best moves + categories for the player's blunders so the cache is
    # populated accurately (best moves let missed_gain be detected reliably).
    best_moves_per_blunder: dict[str, list[str]] = {}
    categories_per_blunder: dict[str, str] = {}

    for blunder in blunders:
        move_index: int = blunder["move_index"]
        idx_str: str = str(move_index)
        best_moves_per_blunder[idx_str] = get_best_moves(pgn, move_index, n_best=3)
        categories_per_blunder[idx_str] = resolve_category(move_data, fens, uci_moves, move_index, best_moves_per_blunder[idx_str])

    blunder_categories: dict[str, int] = _category_breakdown(blunders, move_data, categories_per_blunder)

    # Persist to cache unless this is a guest session.
    if not is_guest:
        store_game(cache, game_url, pgn, move_data, fens, uci_moves, best_moves_per_blunder, DEPTH, categories_per_blunder)

    white_accuracy, black_accuracy = _resolve_accuracies(game, computed_acc)

    return GameAnalysisResult(
        blunder_count=blunder_count,
        first_blunder_fen=first_fen,
        first_blunder_color=first_color,
        white_accuracy=white_accuracy,
        black_accuracy=black_accuracy,
        blunder_categories=blunder_categories,
    )
