"""Chess Blunder Trainer — Streamlit UI.

Five screens driven by st.session_state["screen"]:
  setup    → training parameters
  loading  → analysis pipeline with live progress
  trainer  → review each blunder one by one
  reveal   → feedback on the submitted move
  summary  → end-of-session statistics
"""

import chess
import streamlit as st

from analysis import DEPTH, get_response_and_eval
from api import get_player_profile, get_recent_games
from cache import get_cache_stats, is_cached, load_cache
from components.chessboard import render_chess_component
from trainer import (
    build_session,
    get_current_blunder,
    get_summary,
    submit_attempt,
)

# ── Utility ───────────────────────────────────────────────────────────────────

def _cap_cp_loss(cp_loss: int) -> str:
    """Format cp_loss for display, capping unrealistically large mate-score values."""
    if cp_loss >= 3000:
        return "999+"
    return str(cp_loss)


def _reset_loading() -> None:
    """Clear loading-phase state so the pipeline can be re-run."""
    for key in ("analysis_done", "session"):
        st.session_state.pop(key, None)


def _go_setup(keep_username: bool = False) -> None:
    """Transition to the setup screen, optionally preserving the username."""
    username: str = st.session_state.get("username", "")
    _reset_loading()

    for key in list(st.session_state.keys()):
        del st.session_state[key]

    if keep_username:
        st.session_state["username"] = username

    st.session_state["screen"] = "setup"
    st.rerun()


# ── Screen 1: Setup ───────────────────────────────────────────────────────────

def screen_setup() -> None:
    """Render the setup screen where the user enters training parameters."""
    st.title("♟ Chess Blunder Trainer")
    st.subheader("Connect your Chess.com account")

    col1, col2 = st.columns(2)

    # Prefill username if it was preserved after "Change Settings"
    default_username: str = st.session_state.get("username", "OrangeMutante")

    with col1:
        username: str = st.text_input("Chess.com username", value=default_username)

    with col2:
        time_class: str = st.selectbox("Time control", ["rapid", "blitz", "bullet", "daily"])

    n_games: int = st.slider("Number of games to analyse", min_value=1, max_value=20, value=5)
    threshold: int = st.slider(
        "Blunder threshold (centipawn loss)",
        min_value=50,
        max_value=300,
        value=100,
        step=25,
        help="Moves with cp loss above this value are shown as blunders",
    )

    if st.button("Start Training →"):
        st.session_state["username"] = username
        st.session_state["time_class"] = time_class
        st.session_state["n_games"] = n_games
        st.session_state["threshold"] = threshold
        st.session_state["screen"] = "loading"
        st.rerun()

    # Show cache stats so the user knows how much work is already done.
    _cache = load_cache()
    _stats = get_cache_stats(_cache)
    if _stats["total_games"] > 0:
        st.caption(
            f"💾 Cache: {_stats['total_games']} games stored "
            f"({_stats['total_size_kb']:.1f} KB) — "
            f"last analysed {_stats['newest_entry'][:10]}"
        )


# ── Screen 2: Loading ─────────────────────────────────────────────────────────

def screen_loading() -> None:
    """Render the loading screen: fetch games, run analysis, build session."""
    username: str = st.session_state["username"]
    time_class: str = st.session_state["time_class"]
    n_games: int = st.session_state["n_games"]
    threshold: int = st.session_state["threshold"]

    # If analysis already completed (e.g. on a rerun), jump straight to trainer.
    if st.session_state.get("analysis_done"):
        st.session_state["screen"] = "trainer"
        st.rerun()
        return

    def _back_button() -> None:
        _reset_loading()
        st.session_state["screen"] = "setup"
        st.rerun()

    try:
        with st.status("Preparing your training session...", expanded=True) as status:
            status.update(label=f"Fetching profile for {username}...")
            get_player_profile(username)

            status.update(label=f"Fetching last {n_games} {time_class} games...")
            games: list[dict] = get_recent_games(username, time_class, n_games)

            if not games:
                status.update(label="No games found.", state="error")
                st.warning(
                    "No games found for that username and time control. "
                    "Try more games or a different time control."
                )
                if st.button("← Back"):
                    _back_button()
                return

            # Show per-game cache status before the (potentially slow) analysis.
            game_cache: dict = load_cache()
            for i, game in enumerate(games):
                if is_cached(game_cache, game["url"], DEPTH):
                    status.update(label=f"✓ Game {i + 1} loaded from cache")
                else:
                    status.update(label=f"⚙ Analysing game {i + 1} / {len(games)}...")

            status.update(label="Analysing positions and fetching best moves...")
            session: dict = build_session(username, time_class, games, threshold)

            n_blunders: int = len(session["all_blunders"])

            if n_blunders == 0:
                status.update(label="No blunders found.", state="complete")
                st.warning(
                    "No blunders found with the current threshold. "
                    "Try more games or lower the blunder threshold."
                )
                if st.button("← Back"):
                    _back_button()
                return

            status.update(
                label=f"Ready! Found {n_blunders} blunders to review.",
                state="complete",
            )

        st.session_state["session"] = session
        st.session_state["analysis_done"] = True
        st.session_state["screen"] = "trainer"
        st.rerun()

    except ValueError as exc:
        st.error(str(exc))
        if st.button("← Back"):
            _back_button()

    except Exception as exc:
        st.error(f"Unexpected error: {exc}")
        if st.button("← Back"):
            _back_button()


# ── Screen 3: Trainer ─────────────────────────────────────────────────────────

def _trainer_state_keys(current: int) -> tuple[str, str, str, str]:
    """Return the four per-blunder session_state key names."""
    return (
        f"trainer_fen_{current}",
        f"trainer_eval_{current}",
        f"trainer_first_move_{current}",
        f"trainer_comp_idx_{current}",
    )


def _clean_trainer_state(current: int, comp_idx: int) -> None:
    """Remove all per-blunder state for the given position."""
    fen_key, eval_key, first_move_key, comp_idx_key = _trainer_state_keys(current)
    for k in (fen_key, eval_key, first_move_key, comp_idx_key):
        st.session_state.pop(k, None)
    st.session_state.pop(f"move_input_trainer_{current}_{comp_idx}", None)
    st.session_state.pop(f"trainer_pending_sf_{current}", None)


def screen_trainer() -> None:
    """Render the trainer loop: show one blunder at a time and capture the user's move."""
    session: dict = st.session_state["session"]
    blunder: dict | None = get_current_blunder(session)

    # All blunders reviewed — proceed to summary.
    if blunder is None:
        st.session_state["screen"] = "summary"
        st.rerun()
        return

    total: int = len(session["all_blunders"])
    current: int = session["current_position"]

    fen_key, eval_key, first_move_key, comp_idx_key = _trainer_state_keys(current)
    pending_sf_key: str = f"trainer_pending_sf_{current}"

    # Initialise per-blunder state on first visit.
    if fen_key not in st.session_state:
        initial_cp: int = blunder["cp_loss"] if blunder["color"] == "black" else -blunder["cp_loss"]
        st.session_state[fen_key]        = blunder["fen_before"]
        st.session_state[eval_key]       = initial_cp
        st.session_state[first_move_key] = None
        st.session_state[comp_idx_key]   = 0

    current_fen: str       = st.session_state[fen_key]
    current_eval: int      = st.session_state[eval_key]
    comp_idx: int          = st.session_state[comp_idx_key]
    first_move: str | None = st.session_state[first_move_key]
    show_arrows: bool      = st.session_state.get("show_arrows", False)
    is_initial: bool       = (comp_idx == 0)

    # Consume any pending Stockfish response: advance the stored FEN to post-SF
    # position now so the NEXT user move starts from the correct square.
    # The FEN passed to the component stays at pre-SF so the animation plays from there.
    pending_sf: str | None = st.session_state.get(pending_sf_key)
    if pending_sf:
        board_tmp = chess.Board(current_fen)
        board_tmp.push(chess.Move.from_uci(pending_sf))
        st.session_state.pop(pending_sf_key, None)
        st.session_state[fen_key] = board_tmp.fen()
        # current_fen intentionally NOT updated — component renders at pre-SF FEN
        # so chessboard.js can animate the SF piece from its origin square.

    # Progress bar (0.0 → 1.0)
    st.progress(current / total)
    st.caption(
        f"Game {blunder['game_index'] + 1} / {len(session['games'])}  "
        f"•  Blunder {current + 1} / {total}"
    )

    cp_display: str = _cap_cp_loss(blunder["cp_loss"])
    st.warning(
        f"⚠️ In this game you played **{blunder['move_san']}** — which was a blunder "
        f"(cp loss: {cp_display}). What would you have played instead?"
    )

    col_board, col_buttons = st.columns([3, 1])

    with col_buttons:
        arrow_label: str = "Hide Arrows" if show_arrows else "Show Arrows"
        if st.button(arrow_label):
            st.session_state["show_arrows"] = not show_arrows
            st.rerun()

        if st.button("Reset Position"):
            _clean_trainer_state(current, comp_idx)
            st.rerun()

        if first_move is None:
            if st.button("Skip →"):
                session["current_position"] += 1
                _clean_trainer_state(current, comp_idx)
                st.rerun()
        else:
            if st.button("Review →", type="primary"):
                last_result: dict = submit_attempt(session, first_move)
                st.session_state["last_result"] = last_result
                _clean_trainer_state(current, comp_idx)
                st.session_state["screen"] = "reveal"
                st.rerun()

        st.divider()
        sf_depth: int = st.slider(
            "Stockfish depth",
            min_value=5,
            max_value=20,
            value=10,
            key="sf_response_depth",
            help="Higher = stronger but slower (10 is fast, 15 matches game analysis)",
        )

        if pending_sf:
            st.info("♟ Stockfish responded")

    # Arrows are only meaningful at the original blunder position.
    show_now: bool = show_arrows and is_initial

    with col_board:
        user_move: str | None = render_chess_component(
            fen=current_fen,
            orientation=blunder["color"],
            best_moves=blunder["best_moves"],
            blunder_move=blunder["uci_played"],
            cp_score=current_eval,
            key=f"trainer_{current}_{comp_idx}",
            interactive=True,
            show_arrows=show_now,
            autoplay_move=pending_sf,
        )

    if user_move:
        # Record the first user move for grading; subsequent moves are free exploration.
        if st.session_state[first_move_key] is None:
            st.session_state[first_move_key] = user_move

        # Step 1: push only the user's move and save that FEN.
        board: chess.Board = chess.Board(current_fen)
        board.push(chess.Move.from_uci(user_move))
        fen_after_user: str = board.fen()

        # Step 2: ask Stockfish for its response (without pushing it yet).
        with st.spinner("♟ Stockfish is thinking..."):
            if not board.is_game_over():
                sf_move, new_eval = get_response_and_eval(fen_after_user, depth=sf_depth)
            else:
                sf_move, new_eval = None, current_eval

        # Step 3: store the user-move FEN + the pending SF reply separately.
        # The animation rerun will render the board at fen_after_user, animate
        # sf_move, then advance fen_key to the post-SF position.
        st.session_state[fen_key]    = fen_after_user
        st.session_state[eval_key]   = new_eval
        st.session_state[pending_sf_key] = sf_move
        st.session_state.pop(f"move_input_trainer_{current}_{comp_idx}", None)
        st.session_state[comp_idx_key] = comp_idx + 1
        st.rerun()


# ── Screen 4: Reveal ──────────────────────────────────────────────────────────

def screen_reveal() -> None:
    """Render feedback for the last submitted move."""
    session: dict = st.session_state["session"]
    last_result: dict = st.session_state["last_result"]

    # Retrieve the blunder that was just answered.
    # current_position was already advanced by submit_attempt, so look back by 1.
    prev_index: int = session["current_position"] - 1
    blunder: dict = session["all_blunders"][prev_index]

    if last_result["was_correct"]:
        st.success("✅ Correct! That was one of the best moves.")
    else:
        st.error("❌ Not quite.")

    # Convert stored UCI moves to SAN for display using the pre-blunder position.
    board_for_display = chess.Board(blunder["fen_before"])
    user_san: str = board_for_display.san(chess.Move.from_uci(last_result["uci_played"]))
    blunder_san: str = board_for_display.san(chess.Move.from_uci(last_result["uci_blunder"]))

    col1, col2 = st.columns(2)

    with col1:
        st.write(f"**You played:** {user_san}")

    with col2:
        cp_display: str = _cap_cp_loss(last_result["cp_loss"])
        st.write(
            f"**In the game:** {blunder_san}  "
            f"*(BLUNDER, cp loss: {cp_display})*"
        )

    # Show best moves in SAN; fall back to UCI if SAN conversion fails.
    best_sans: list[str] = []
    for uci in last_result["best_moves"]:
        try:
            best_sans.append(board_for_display.san(chess.Move.from_uci(uci)))
        except ValueError:
            best_sans.append(uci)

    st.write("**Stockfish best moves:**", "  •  ".join(best_sans))

    # cp_score from white's POV after the blunder.
    cp_after: int = last_result["cp_loss"] if blunder["color"] == "black" else -last_result["cp_loss"]

    render_chess_component(
        fen=blunder["fen_before"],
        orientation=blunder["color"],
        best_moves=last_result["best_moves"],
        blunder_move=last_result["uci_blunder"],
        cp_score=cp_after,
        key=f"reveal_{session['current_position']}",
        interactive=False,
        show_arrows=True,
    )

    if st.button("Next Blunder →", type="primary"):
        st.session_state["screen"] = "trainer"
        st.rerun()


# ── Screen 5: Summary ─────────────────────────────────────────────────────────

def screen_summary() -> None:
    """Render the end-of-session summary with stats and navigation."""
    session: dict = st.session_state["session"]
    stats: dict = get_summary(session)
    games: list[dict] = session["games"]

    st.title("Session Complete 🏁")

    col1, col2, col3 = st.columns(3)

    with col1:
        st.metric("Blunders reviewed", stats["total_reviewed"])

    with col2:
        st.metric("Correct", stats["correct"])

    with col3:
        st.metric("Accuracy", f"{stats['accuracy_pct']:.0f}%")

    st.divider()

    worst_idx: int = stats["worst_game_index"]
    best_idx: int = stats["best_game_index"]

    if games:
        st.write("**Worst game** (most blunders):", games[worst_idx].get("url", "—"))
        st.write("**Best game** (fewest blunders):", games[best_idx].get("url", "—"))

    col_again, col_change = st.columns(2)

    with col_again:
        if st.button("Train Again →", type="primary"):
            _go_setup(keep_username=False)

    with col_change:
        if st.button("Change Settings →"):
            _go_setup(keep_username=True)


# ── App entry point ───────────────────────────────────────────────────────────

def main() -> None:
    """Route to the correct screen based on session_state["screen"]."""
    st.set_page_config(page_title="Chess Blunder Trainer", page_icon="♟", layout="wide")

    # Initialise screen on first load.
    if "screen" not in st.session_state:
        st.session_state["screen"] = "setup"

    screen: str = st.session_state["screen"]

    if screen == "setup":
        screen_setup()
    elif screen == "loading":
        screen_loading()
    elif screen == "trainer":
        screen_trainer()
    elif screen == "reveal":
        screen_reveal()
    elif screen == "summary":
        screen_summary()
    else:
        # Unknown screen — reset to setup.
        st.session_state["screen"] = "setup"
        st.rerun()


if __name__ == "__main__":
    main()
