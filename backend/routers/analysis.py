"""Analysis router — live Stockfish evaluation and bot-response for the trainer."""

from fastapi import APIRouter, HTTPException

from models import EvaluateRequest, EvaluateResponse, RespondRequest, RespondResponse
from services.stockfish import evaluate_move_quality, evaluate_position, get_response_and_eval, get_best_moves_for_fen, get_blunder_line

router = APIRouter()


@router.post("/evaluate", response_model=EvaluateResponse)
def evaluate_move(req: EvaluateRequest):
    """Evaluate the quality of a single move via Stockfish.

    Used during the reveal screen to show the user how bad their move was
    relative to the best available moves.

    Args (body):
        fen_before: FEN string of the position before the move.
        uci_move:   UCI string of the move to evaluate (e.g. "e2e4").
        depth:      Stockfish search depth (default 10).

    Returns:
        cp_loss, classification, and the eval after the move from white's POV.

    Raises:
        400 if the FEN or UCI move is invalid.
    """
    try:
        cp_loss, classification, eval_white = evaluate_move_quality(req.fen_before, req.uci_move, req.depth)
    except (ValueError, Exception) as exc:
        raise HTTPException(status_code=400, detail=f"Evaluation error: {exc}")

    return EvaluateResponse(cp_loss=cp_loss, classification=classification, eval_after_white_pov=eval_white)


@router.post("/respond", response_model=RespondResponse)
def respond_move(req: RespondRequest):
    """Return Stockfish's best response move for the given FEN position.

    Used by the trainer's bot mode so the engine can reply to the user's moves.

    Args (body):
        fen:   FEN string of the position where Stockfish should respond.
        depth: Stockfish search depth (default 10).

    Returns:
        best_move_uci: UCI string of the engine's response (null if game is over).
        eval_after_white_pov: Centipawn eval after the response from white's POV.

    Raises:
        400 if the FEN is invalid.
    """
    try:
        sf_move, cp = get_response_and_eval(req.fen, req.depth)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Engine error: {exc}")

    return RespondResponse(best_move_uci=sf_move, eval_after_white_pov=cp)


@router.get("/best-moves")
def get_position_best_moves(fen: str, n_best: int = 5):
    """Return up to n_best good moves for the given FEN position.

    Used by the trainer to update arrow suggestions after each move.

    Args (query params):
        fen:    URL-encoded FEN string of the position to analyse.
        n_best: Maximum number of moves to return (default 5).

    Returns:
        { best_moves: list[str] } — UCI strings ordered best-first.

    Raises:
        400 if the FEN is invalid.
    """
    try:
        moves = get_best_moves_for_fen(fen, n_best=n_best)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Engine error: {exc}")

    return {"best_moves": moves}


@router.get("/blunder-line")
def get_blunder_sequence(fen: str, blunder_uci: str, depth: int = 10, n_moves: int = 5):
    """Return the blunder move + Stockfish's PV continuation as a UCI move list.

    Args (query params):
        fen:         FEN of the position before the blunder.
        blunder_uci: UCI string of the blunder move (e.g. "e5d3").
        depth:       Stockfish search depth (default 10).
        n_moves:     Max continuation moves after the blunder (default 5).

    Returns:
        { moves: list[str] } — blunder + continuation UCIs.

    Raises:
        400 if the FEN or UCI move is invalid.
    """
    try:
        moves = get_blunder_line(fen, blunder_uci, depth, n_moves)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Engine error: {exc}")
    return {"moves": moves}


@router.get("/position")
def evaluate_fen(fen: str):
    """Return Stockfish's evaluation of a position from white's POV.

    Used by the trainer to set the initial eval bar when the blunder is loaded
    from cache (which may predate the eval_before_white_pov field).

    Args (query param):
        fen: URL-encoded FEN string of the position to evaluate.

    Returns:
        { eval_white_pov: int } — centipawns from white's perspective.

    Raises:
        400 if the FEN is invalid.
    """
    try:
        cp = evaluate_position(fen)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Evaluation error: {exc}")

    return {"eval_white_pov": cp}
