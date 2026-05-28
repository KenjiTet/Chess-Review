"""Isolation test for the interactive chess board component.

Run with:
    streamlit run test_component.py

Verify:
  1. Board renders at 560x560 with black at bottom.
  2. Green arrow on e7→e5, blue on c7→c5, red on d7→d5.
  3. Eval bar shows a slightly negative position (−0.6).
  4. Dragging a black piece to a legal square triggers st.success.
  5. Dragging to an illegal square animates the piece back.

Delete this file after verification.
"""

import streamlit as st
from components.chessboard import render_chess_component

st.title("Component test")

move: str | None = render_chess_component(
    fen="rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
    orientation="black",
    best_moves=["e7e5", "c7c5", "d7d6"],
    cp_score=-60,
    key="test",
    interactive=True,
    show_arrows=True,
)

if move:
    st.success(f"Move captured: {move}")
