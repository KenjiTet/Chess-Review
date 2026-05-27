"""Renders the chess board by injecting args into index.html and serving via components.html()."""

import json
import os

import streamlit as st
import streamlit.components.v1 as components

_FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")


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
    """Render the chess board and return the UCI move played, or None."""
    html_path = os.path.join(_FRONTEND_DIR, "index.html")
    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()

    args_json = json.dumps({
        "fen": fen,
        "orientation": orientation,
        "bestMoves": best_moves,
        "blunderMove": blunder_move,
        "cpScore": cp_score,
        "showArrows": show_arrows,
        "autoplayMove": autoplay_move,
        "interactive": interactive,
        "key": key or "chessboard",
    })
    injection = f"<script>window.__CHESS_ARGS__ = {args_json};</script>"
    html = html.replace("</head>", injection + "\n</head>")

    components.html(html, height=590, scrolling=False)

    input_key = f"move_input_{key}"
    st.markdown(
        f'<style>div[data-testid="stTextInput"]:has(input[aria-label="{input_key}"]) '
        f'{{display:none}}</style>',
        unsafe_allow_html=True,
    )
    result: str = st.text_input(label=input_key, key=input_key)
    return result if result else None
