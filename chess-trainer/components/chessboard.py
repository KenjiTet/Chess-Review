"""Thin wrapper around chess_input — preserves the render_chess_component() API."""

from components.chess_input import chess_input


def render_chess_component(
    fen: str,
    orientation: str,
    best_moves: list[str],
    blunder_move: str,
    cp_score: int,
    key: str = "chessboard",
    interactive: bool = True,
    show_arrows: bool = False,
    autoplay_move: str | None = None,
) -> str | None:
    """Render an interactive chessboard.

    When interactive=True, returns the UCI move string once the user drags a
    piece; returns None until then. When interactive=False, always returns None.
    """
    return chess_input(
        fen=fen,
        orientation=orientation,
        best_moves=best_moves,
        blunder_move=blunder_move,
        cp_score=cp_score,
        show_arrows=show_arrows,
        autoplay_move=autoplay_move or "",
        interactive=interactive,
        key=key,
    )
