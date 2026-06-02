"""Session management router — build, query, attempt, and summarise training sessions."""

import json
from uuid import uuid4

import requests as req_lib
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from models import (
    AttemptRequest,
    AttemptResponse,
    BlunderResponse,
    SessionCreateRequest,
    SessionCreateResponse,
    SkipRequest,
    SummaryResponse,
)
from services.cache import get_cached_game, is_cached, load_cache, store_game
from services.chess_com import get_game_by_url, get_recent_games
from services.stockfish import DEPTH, analyze_game, extract_clocks, find_blunders, get_best_moves, get_board_snapshots
from services.trainer import build_session, get_current_blunder, get_summary, submit_attempt

router = APIRouter()

# In-memory session store — keyed by session_id UUID string.
# TODO: replace with Redis/DB for persistence beyond server restarts
SESSIONS: dict[str, dict] = {}


def _sse(data: dict) -> str:
    """Format a dict as a Server-Sent Events data line."""
    return f"data: {json.dumps(data)}\n\n"


def _build_stream_generator(
    username: str,
    time_class: str,
    n_games: int,
    threshold: int,
    game_url: str | None = None,
):
    """Sync generator that yields SSE events while building a training session.

    Progress is reported per game so the frontend can show a progress bar.
    Stockfish analysis blocks this thread (acceptable for a local single-user tool).
    Final event has status "done" and includes session_id, blunder_count, and game_urls.
    Error event has status "error" and includes an error message string.
    """
    try:
        yield _sse({"status": "Fetching games...", "pct": 5})

        if game_url:
            game: dict = get_game_by_url(username, game_url)
            games: list[dict] = [game]
        else:
            games = get_recent_games(username, time_class, n_games)

        if not games:
            yield _sse({"status": "No matching games found.", "pct": 100, "error": "no_games"})
            return

        game_count: int = len(games)
        yield _sse({"status": f"Found {game_count} game(s). Analysing...", "pct": 10})

        cache: dict = load_cache()
        all_blunders: list[dict] = []

        for i, game in enumerate(games):
            # Progress: 10% base + 80% spread across game analysis
            pct: int = 10 + int((i / game_count) * 80)
            yield _sse({"status": f"Analysing game {i + 1}/{game_count}...", "pct": pct})

            pgn: str = game.get("pgn", "")
            url: str = game.get("url", "")

            # Player info from the chess.com game dict
            white_info: dict = game.get("white", {})
            black_info: dict = game.get("black", {})
            white_username: str = white_info.get("username", "")
            white_rating: int = white_info.get("rating", 0)
            black_username: str = black_info.get("username", "")
            black_rating: int = black_info.get("rating", 0)
            clocks: list[str] = extract_clocks(pgn)

            if not pgn:
                continue

            if is_cached(cache, url, DEPTH):
                # Fast path: use pre-computed data from disk cache
                entry: dict = get_cached_game(cache, url)
                move_data: list[dict] = entry["move_data"]
                fens: list[str] = entry["fens"]
                uci_moves: list[str] = entry["uci_moves"]
                best_moves_per_blunder: dict[str, list[str]] = dict(entry["best_moves_per_blunder"])
            else:
                # Slow path: run Stockfish analysis (blocks this thread ~60s per game)
                move_data = analyze_game(pgn)
                fens, uci_moves = get_board_snapshots(pgn)
                best_moves_per_blunder = {}

            blunders: list[dict] = find_blunders(move_data, min_cp_loss=threshold)
            cache_needs_update: bool = not is_cached(cache, url, DEPTH)

            for blunder in blunders:
                move_index: int = blunder["move_index"]
                idx_str: str = str(move_index)

                if idx_str not in best_moves_per_blunder:
                    # Position missing from cache — threshold may have been lowered
                    best_moves_per_blunder[idx_str] = get_best_moves(pgn, move_index, n_best=3)
                    cache_needs_update = True

                best_moves: list[str] = best_moves_per_blunder[idx_str]

                if move_index > 0:
                    prev_fen: str | None = fens[move_index - 1]
                    prev_move_uci: str | None = uci_moves[move_index - 1]
                else:
                    prev_fen = None
                    prev_move_uci = None

                # Clock times at the blunder position
                time_white: str | None = None
                time_black: str | None = None
                if clocks:
                    if move_index % 2 == 0:
                        if move_index < len(clocks):
                            time_white = clocks[move_index]
                        if move_index > 0 and move_index - 1 < len(clocks):
                            time_black = clocks[move_index - 1]
                    else:
                        if move_index < len(clocks):
                            time_black = clocks[move_index]
                        if move_index - 1 < len(clocks):
                            time_white = clocks[move_index - 1]

                all_blunders.append({
                    "game_index": i,
                    "move_index": move_index,
                    "move_number": blunder["move_number"],
                    "color": blunder["color"],
                    "move_san": blunder["move_san"],
                    "cp_loss": blunder["cp_loss"],
                    "classification": blunder["classification"],
                    "fen_before": fens[move_index],
                    "uci_played": uci_moves[move_index],
                    "best_moves": best_moves,
                    "prev_fen": prev_fen,
                    "prev_move_uci": prev_move_uci,
                    # 0 fallback for games loaded from cache before this field was added
                    "eval_before_white_pov": blunder.get("eval_before_white_pov", 0),
                    # Full game position history for < > navigation
                    "game_fens": fens,
                    "game_uci_moves": uci_moves,
                    "white_username": white_username,
                    "white_rating": white_rating,
                    "black_username": black_username,
                    "black_rating": black_rating,
                    "time_remaining_white": time_white,
                    "time_remaining_black": time_black,
                })

            if cache_needs_update:
                store_game(cache, url, pgn, move_data, fens, uci_moves, best_moves_per_blunder, DEPTH)

        session_id: str = str(uuid4())
        SESSIONS[session_id] = {
            "username": username,
            "time_class": time_class,
            "games": games,
            "all_blunders": all_blunders,
            "current_position": 0,
            "attempts": [],
        }

        collected_urls: list[str] = [g.get("url", "") for g in games if g.get("url")]
        yield _sse({
            "status": "done",
            "pct": 100,
            "session_id": session_id,
            "blunder_count": len(all_blunders),
            "game_urls": collected_urls,
        })

    except req_lib.RequestException as exc:
        # Surface Chess.com API failures to the frontend loading screen
        yield _sse({"status": "error", "pct": 0, "error": f"Chess.com API error: {exc}"})
    except Exception as exc:
        yield _sse({"status": "error", "pct": 0, "error": str(exc)})


@router.get("/build-stream")
def build_stream(
    username: str,
    time_class: str,
    n_games: int,
    threshold: int,
    game_url: str | None = None,
):
    """Stream SSE progress events while building a training session.

    Yields 'Fetching games...', per-game analysis updates, then a final
    'done' event with session_id, blunder_count, and game_urls for the frontend.
    If game_url is provided, builds the session from that specific game only.
    """
    return StreamingResponse(
        _build_stream_generator(username, time_class, n_games, threshold, game_url),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/build", response_model=SessionCreateResponse)
def build_session_sync(req: SessionCreateRequest):
    """Build a training session synchronously (blocks until complete).

    Prefer /build-stream for frontend use — this endpoint is useful for
    testing and simple CLI clients where progress streaming is not needed.
    """
    try:
        games: list[dict] = get_recent_games(req.username, req.time_class, req.n_games)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except req_lib.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Chess.com API error: {exc}")

    session: dict = build_session(req.username, req.time_class, games, req.threshold)
    session_id: str = str(uuid4())
    SESSIONS[session_id] = session

    return SessionCreateResponse(session_id=session_id, blunder_count=len(session["all_blunders"]))


@router.get("/blunder", response_model=BlunderResponse)
def get_blunder(session_id: str):
    """Return the current blunder position for a session.

    Returns 404 if the session does not exist or all blunders have been reviewed.
    """
    session = SESSIONS.get(session_id)

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found.")

    blunder = get_current_blunder(session)

    if blunder is None:
        raise HTTPException(status_code=404, detail="No more blunders — session complete.")

    return BlunderResponse(**blunder)


@router.post("/attempt", response_model=AttemptResponse)
def post_attempt(req: AttemptRequest):
    """Record the user's move attempt for the current blunder and advance.

    Returns whether the attempt was correct, cp_loss, classification, and the
    list of best moves so the frontend can show the reveal screen.
    """
    session = SESSIONS.get(req.session_id)

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found.")

    if session["current_position"] >= len(session["all_blunders"]):
        raise HTTPException(status_code=409, detail="Session already complete.")

    result: dict = submit_attempt(session, req.uci_move)

    return AttemptResponse(
        correct=result["was_correct"],
        cp_loss=result["cp_loss"],
        classification=result["classification"],
        best_moves=result["best_moves"],
        uci_blunder=result["uci_blunder"],
    )


@router.post("/skip")
def skip_blunder(req: SkipRequest):
    """Advance past the current blunder without recording an attempt."""
    session = SESSIONS.get(req.session_id)

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found.")

    if session["current_position"] >= len(session["all_blunders"]):
        raise HTTPException(status_code=409, detail="Session already complete.")

    session["current_position"] += 1
    return {"skipped": True}


@router.get("/summary", response_model=SummaryResponse)
def get_session_summary(session_id: str):
    """Return end-of-session performance statistics.

    Includes accuracy, total blunders reviewed, and URLs of best/worst games.
    """
    session = SESSIONS.get(session_id)

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found.")

    stats: dict = get_summary(session)
    games: list[dict] = session["games"]

    # Derive game URLs for best/worst game links in the summary screen
    worst_url: str | None = games[stats["worst_game_index"]].get("url") if games else None
    best_url: str | None = games[stats["best_game_index"]].get("url") if games else None

    return SummaryResponse(
        total_blunders=stats["total_blunders"],
        total_reviewed=stats["total_reviewed"],
        correct=stats["correct"],
        accuracy_pct=stats["accuracy_pct"],
        best_game_url=best_url,
        worst_game_url=worst_url,
    )
