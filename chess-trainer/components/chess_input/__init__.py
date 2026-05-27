"""Streamlit bidirectional component wrapper for the chess board."""

import os
import streamlit.components.v1 as components

_COMPONENT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")

_component_func = components.declare_component(
    "chess_input",
    path=_COMPONENT_DIR,
)


def chess_input(
    fen: str,
    orientation: str,
    best_moves: list[str],
    blunder_move: str,
    cp_score: int,
    show_arrows: bool = False,
    autoplay_move: str = "",
    interactive: bool = True,
    key: str = None,
) -> str | None:
    """Render the chess board; returns UCI move string once the user drags a piece."""
    return _component_func(
        fen=fen,
        orientation=orientation,
        bestMoves=best_moves,
        blunderMove=blunder_move,
        cpScore=cp_score,
        showArrows=show_arrows,
        autoplayMove=autoplay_move,
        interactive=interactive,
        key=key,
        default=None,
    )
