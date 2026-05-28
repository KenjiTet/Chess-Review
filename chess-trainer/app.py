"""Chess Blunder Trainer — Streamlit UI.

Five screens driven by st.session_state["screen"]:
  setup    → training parameters
  loading  → analysis pipeline with live progress
  trainer  → review each blunder one by one
  reveal   → feedback on the submitted move
  summary  → end-of-session statistics
"""

from typing import Any

import chess
import streamlit as st

from analysis import DEPTH, evaluate_move_quality, evaluate_position, get_best_moves_for_fen, get_response_and_eval
from api import get_player_profile, get_recent_games
from cache import get_cache_stats, is_cached, load_cache
from components.chessboard import render_chess_component
from components.move_bridge import clear_pending_move
from trainer import (
    build_session,
    get_current_blunder,
    get_summary,
    submit_attempt,
)

# ── Constants ─────────────────────────────────────────────────────────────────

_QUALITY_LABELS: dict[str, str] = {
    "best": "Best move!",
    "good": "Good",
    "inaccuracy": "Inaccuracy",
    "mistake": "Mistake",
    "blunder": "Blunder!",
}

_QUALITY_COLORS_DARK: dict[str, str] = {
    "best": "#22c55e",
    "good": "#84cc16",
    "inaccuracy": "#f59e0b",
    "mistake": "#f97316",
    "blunder": "#ef4444",
}

_QUALITY_COLORS_LIGHT: dict[str, str] = {
    "best": "#15803d",
    "good": "#4d7c0f",
    "inaccuracy": "#b45309",
    "mistake": "#c2410c",
    "blunder": "#b91c1c",
}

_QUALITY_BG: dict[str, str] = {
    "best": "rgba(34,197,94,0.12)",
    "good": "rgba(132,204,22,0.12)",
    "inaccuracy": "rgba(245,158,11,0.12)",
    "mistake": "rgba(249,115,22,0.12)",
    "blunder": "rgba(239,68,68,0.12)",
}

# ── Theme CSS ──────────────────────────────────────────────────────────────────

def _build_css(dark: bool) -> str:
    """Return full CSS for the given theme mode."""
    bg          = "#1a1f2e"       if dark else "#f4f0e8"
    surface     = "#242b3d"       if dark else "#ffffff"
    border      = "#3a4460"       if dark else "rgba(0,0,0,0.1)"
    text        = "#e8e6e0"       if dark else "#1a1612"
    muted       = "#8a96aa"       if dark else "#7a6e5e"
    gold        = "#e2a03f"       if dark else "#c8861f"
    gold_lt     = "#f1c46d"       if dark else "#e2a03f"
    gold_dk     = "#c8822a"       if dark else "#9a6810"
    gold_text   = "#1a1f2e"       if dark else "#ffffff"
    divider     = "#3a4460"       if dark else "rgba(0,0,0,0.1)"
    ph_border   = "#2e3d55"       if dark else "rgba(0,0,0,0.08)"
    btn_sec_bg  = "rgba(255,255,255,0.06)" if dark else "rgba(0,0,0,0.04)"
    btn_sec_bd  = "#3a4460"       if dark else "rgba(0,0,0,0.18)"
    pb_track    = "#2d3650"       if dark else "#e8dfc8"
    shadow      = ("0 2px 12px rgba(0,0,0,0.45), 0 1px 4px rgba(0,0,0,0.25)"
                   if dark else
                   "0 2px 12px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.05)")
    shadow_card = ("0 16px 48px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)"
                   if dark else
                   "0 16px 48px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.9)")
    settings_bg = "#0e1117" if dark else "#ffffff"
    settings_border = "rgba(226,160,63,0.18)" if dark else "rgba(0,0,0,0.13)"
    settings_shadow = (
        "0 0 0 1px rgba(226,160,63,0.10), "
        "0 2px 8px rgba(0,0,0,0.55), "
        "0 12px 40px rgba(0,0,0,0.60), "
        "0 32px 80px rgba(0,0,0,0.45), "
        "inset 0 1px 0 rgba(255,255,255,0.04)"
        if dark else
        "0 0 0 1px rgba(0,0,0,0.07), "
        "0 2px 8px rgba(0,0,0,0.06), "
        "0 12px 40px rgba(0,0,0,0.10), "
        "0 32px 80px rgba(0,0,0,0.07), "
        "inset 0 1px 0 rgba(255,255,255,1)"
    )
    hdr_color   = "#6a7a98"       if dark else "#9a8c78"
    pill_bg     = "rgba(255,255,255,0.07)" if dark else "rgba(0,0,0,0.05)"
    alert_color = "#fde68a"       if dark else "#92600a"
    link_color  = "#60a5fa"       if dark else "#2563eb"
    success_c   = "#22c55e"       if dark else "#15803d"
    success_s   = "#86efac"       if dark else "#166534"
    error_c     = "#ef4444"       if dark else "#dc2626"
    error_s     = "#fca5a5"       if dark else "#991b1b"

    return f"""
/* ── Global ─────────────────────────────── */
#MainMenu {{ visibility: hidden; }}
footer {{ visibility: hidden; }}
html, body, [data-testid="stAppViewContainer"], [data-testid="stApp"],
[data-testid="stMain"], [data-testid="stAppViewBlockContainer"] {{
  background-color: {bg} !important;
  color: {text} !important;
}}
[data-testid="stHeader"] {{
  background-color: {bg} !important;
  border-bottom: 1px solid {divider};
}}
div.block-container {{
  padding-top: 3.5rem !important;
  padding-bottom: 3rem !important;
  padding-left: 2.5rem !important;
  padding-right: 2.5rem !important;
  max-width: 1200px !important;
}}

/* ── Primary buttons ─────────────────────── */
button[data-testid="baseButton-primary"],
div[data-testid="stButton"] > button[kind="primary"] {{
  background: linear-gradient(135deg, {gold} 0%, {gold_dk} 100%) !important;
  color: {gold_text} !important;
  border: none !important;
  border-radius: 8px !important;
  font-weight: 600 !important;
  box-shadow: 0 4px 14px rgba(200,134,31,0.35) !important;
  transition: all 0.2s ease !important;
}}
button[data-testid="baseButton-primary"]:hover,
div[data-testid="stButton"] > button[kind="primary"]:hover {{
  background: linear-gradient(135deg, {gold_lt} 0%, {gold} 100%) !important;
  box-shadow: 0 6px 20px rgba(200,134,31,0.5) !important;
  transform: translateY(-1px) !important;
}}

/* ── Secondary buttons ───────────────────── */
button[data-testid="baseButton-secondary"],
div[data-testid="stButton"] > button[kind="secondary"] {{
  background: {btn_sec_bg} !important;
  border: 1px solid {btn_sec_bd} !important;
  border-radius: 8px !important;
  color: {text} !important;
  font-weight: 600 !important;
  transition: all 0.2s ease !important;
}}
button[data-testid="baseButton-secondary"]:hover,
div[data-testid="stButton"] > button[kind="secondary"]:hover {{
  background: rgba(200,134,31,0.08) !important;
  border-color: {gold} !important;
  color: {gold} !important;
}}

/* ── Metrics ─────────────────────────────── */
div[data-testid="metric-container"] {{
  background: {surface} !important;
  border-radius: 12px !important;
  box-shadow: {shadow} !important;
  padding: 1rem 1.2rem !important;
}}

/* ── Slider ──────────────────────────────── */
div[data-testid="stSlider"] div[role="slider"] {{
  background: {gold} !important;
  border: 2px solid {gold} !important;
  box-shadow: 0 0 0 4px rgba(200,134,31,0.2) !important;
}}

/* ── Status widget ───────────────────────── */
div[data-testid="stStatusWidget"] {{
  background: {surface} !important;
  border: 1px solid {divider} !important;
  border-radius: 10px !important;
}}

/* ── Custom components ───────────────────── */
.chess-hero {{
  text-align: center;
  padding: 1.5rem 1rem 0.75rem;
}}
.chess-hero-icon {{
  font-size: 3.5rem;
  line-height: 1;
  margin-bottom: 0.5rem;
  display: block;
  filter: drop-shadow(0 4px 20px rgba(226,160,63,0.5));
  transition: filter 0.3s ease;
}}
.chess-hero-title {{
  font-size: 2.2rem;
  font-weight: 800;
  background: linear-gradient(135deg, {gold}, {gold_lt});
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 0.4rem;
}}
.chess-hero-sub {{ color: {muted}; font-size: 1rem; }}

.chess-card {{
  background: {surface};
  box-shadow: {shadow};
  border-radius: 14px;
  padding: 1.5rem 1.75rem;
  margin-bottom: 1rem;
}}

.section-divider {{
  border: none;
  border-top: 1px solid {divider};
  margin: 0.8rem 0;
}}

.panel-header {{
  color: {hdr_color};
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  margin-bottom: 0.4rem;
  padding-bottom: 0.35rem;
  border-bottom: 1px solid {ph_border};
}}

.cache-pill {{
  display: inline-block;
  background: {pill_bg};
  border: 1px solid {border};
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 0.75rem;
  color: {muted};
}}

.blunder-alert {{
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  background: rgba(245,158,11,0.09);
  border-left: 4px solid #f59e0b;
  border-radius: 0 10px 10px 0;
  padding: 0.85rem 1rem;
  margin-bottom: 0.75rem;
  color: {alert_color};
}}
.blunder-alert-icon {{ font-size: 1.1rem; flex-shrink: 0; margin-top: 1px; }}
.blunder-alert-text {{ line-height: 1.55; font-size: 0.92rem; }}

.progress-caption {{
  color: {muted};
  font-size: 0.8rem;
  margin-top: 0.35rem;
  margin-bottom: 0.6rem;
}}

.move-log-entry {{
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.4rem 0.65rem;
  border-radius: 7px;
  margin-bottom: 3px;
  border-left: 3px solid;
}}
.move-log-san {{
  font-family: monospace;
  font-size: 0.9rem;
  font-weight: 700;
  color: {text};
}}
.move-log-badge {{
  font-size: 0.68rem;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 999px;
  white-space: nowrap;
}}

.verdict-card-correct {{
  background: rgba(34,197,94,0.09);
  border: 1px solid rgba(34,197,94,0.3);
  border-radius: 14px;
  padding: 1.75rem 2rem;
  text-align: center;
  margin-bottom: 1rem;
}}
.verdict-icon {{ font-size: 2.2rem; display: block; margin-bottom: 0.4rem; }}
.verdict-title-correct {{ font-size: 1.5rem; font-weight: 700; color: {success_c}; }}
.verdict-sub-correct {{ color: {success_s}; font-size: 0.88rem; margin-top: 0.25rem; }}

.verdict-card-wrong {{
  background: rgba(239,68,68,0.09);
  border: 1px solid rgba(239,68,68,0.3);
  border-radius: 14px;
  padding: 1.75rem 2rem;
  text-align: center;
  margin-bottom: 1rem;
}}
.verdict-title-wrong {{ font-size: 1.5rem; font-weight: 700; color: {error_c}; }}
.verdict-sub-wrong {{ color: {error_s}; font-size: 0.88rem; margin-top: 0.25rem; }}

.move-compare-card {{
  background: {surface};
  box-shadow: {shadow};
  border-radius: 12px;
  padding: 1.25rem;
  text-align: center;
}}
.move-compare-label {{
  color: {muted};
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 0.5rem;
}}
.move-compare-san {{
  font-size: 2.2rem;
  font-weight: 800;
  color: {text};
  font-family: monospace;
  margin-bottom: 0.5rem;
  display: block;
}}
.blunder-badge {{
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  background: rgba(239,68,68,0.1);
  color: {error_c};
  border: 1px solid rgba(239,68,68,0.25);
}}

.best-moves-section {{
  background: {surface};
  box-shadow: {shadow};
  border-radius: 10px;
  padding: 0.85rem 1.1rem;
  margin: 0.75rem 0;
}}
.best-moves-label {{
  color: {muted};
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 0.5rem;
}}
.best-moves-pills {{ display: flex; flex-wrap: wrap; gap: 6px; }}
.best-move-pill {{
  background: rgba(34,197,94,0.1);
  border: 1px solid rgba(34,197,94,0.28);
  color: {success_c};
  padding: 4px 12px;
  border-radius: 999px;
  font-family: monospace;
  font-size: 0.88rem;
  font-weight: 600;
}}

.stat-card {{
  background: {surface};
  box-shadow: {shadow};
  border-radius: 14px;
  padding: 1.5rem;
  text-align: center;
}}
.stat-accent-bar {{ height: 4px; border-radius: 999px; margin-bottom: 1rem; }}
.stat-number {{
  font-size: 2.8rem;
  font-weight: 800;
  color: {text};
  line-height: 1;
  margin-bottom: 0.4rem;
}}
.stat-label {{ color: {muted}; font-size: 0.85rem; font-weight: 500; }}

.game-stat-row {{
  background: {surface};
  box-shadow: {shadow};
  border-radius: 10px;
  padding: 0.85rem 1.1rem;
  margin-bottom: 0.5rem;
}}
.game-stat-type {{
  color: {muted};
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 0.35rem;
}}
.game-stat-link {{ color: {link_color}; font-size: 0.82rem; word-break: break-all; }}

.summary-hero {{
  text-align: center;
  padding: 1.5rem 1rem 1rem;
}}
.summary-icon {{ font-size: 3rem; display: block; }}
.summary-title {{ font-size: 2rem; font-weight: 800; color: {text}; margin-top: 0.5rem; }}
.summary-sub {{ color: {muted}; font-size: 0.95rem; margin-top: 0.3rem; }}

@keyframes fadeIn {{
  from {{ opacity: 0; transform: translateY(6px); }}
  to   {{ opacity: 1; transform: translateY(0); }}
}}
.screen-fade {{ animation: fadeIn 0.3s ease; }}

/* ── Setup form card (override Streamlit's flat border) ── */
/* ── Setup form card (override Streamlit's flat border) ── */
[data-testid="stApp"] [data-testid="stVerticalBlockBorderWrapper"],
[data-testid="stApp"] [data-testid="stVerticalBlockBorderWrapper"] > div,
[data-testid="stApp"] [data-testid="stVerticalBlockBorderWrapper"] [data-testid="stVerticalBlock"] {{
  background-color: {settings_bg} !important;
  border-radius: 20px !important;
}}

/* ── Form section headings ──────────────────────────── */
.form-section-header {{
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: {muted};
  margin: 1.5rem 0 0.6rem;
  padding-bottom: 0.45rem;
  border-bottom: 1px solid {divider};
}}

/* ── Settings summary chips (loading screen) ─────────── */
.settings-summary {{
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0.75rem 0 1.5rem;
  justify-content: center;
}}
.settings-chip {{
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: {pill_bg};
  border: 1px solid {border};
  border-radius: 999px;
  padding: 5px 16px;
  font-size: 0.83rem;
  color: {text};
  font-weight: 500;
}}
"""


def _inject_global_css(dark: bool) -> None:
    """Inject global CSS for the current theme."""
    st.markdown(f"<style>{_build_css(dark)}</style>", unsafe_allow_html=True)


# ── Utility ───────────────────────────────────────────────────────────────────

def _quality_colors(dark: bool) -> dict[str, str]:
    """Return quality colors for the active theme."""
    if dark:
        return _QUALITY_COLORS_DARK
    return _QUALITY_COLORS_LIGHT


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
    dark_mode: bool = st.session_state.get("dark_mode", False)
    _reset_loading()

    for key in list(st.session_state.keys()):
        del st.session_state[key]

    if keep_username:
        st.session_state["username"] = username
    st.session_state["dark_mode"] = dark_mode
    st.session_state["screen"] = "setup"
    st.rerun()


# ── Loading logic (shared between setup and legacy loading screen) ─────────────

def _do_setup_loading(slot: Any) -> None:
    """Run the loading pipeline inside the setup screen's reserved slot."""
    username: str   = st.session_state["username"]
    time_class: str = st.session_state["time_class"]
    n_games: int    = st.session_state["n_games"]
    threshold: int  = st.session_state["threshold"]

    def _fail(message: str) -> None:
        st.session_state["setup_loading"] = False
        st.session_state["setup_error"] = message
        st.rerun()

    try:
        with slot:
            with st.status("Preparing your training session...", expanded=True) as status:
                status.update(label=f"Fetching profile for {username}...")
                get_player_profile(username)

                status.update(label=f"Fetching last {n_games} {time_class} games...")
                games: list[dict] = get_recent_games(username, time_class, n_games)

                if not games:
                    status.update(label="No games found.", state="error")
                    _fail(
                        "No games found for that username and time control. "
                        "Try more games or a different time control."
                    )
                    return

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
                    _fail(
                        "No blunders found with the current threshold. "
                        "Try more games or lower the blunder threshold."
                    )
                    return

                status.update(
                    label=f"✓ Ready! Found {n_blunders} blunders to review.",
                    state="complete",
                )

        st.session_state["session"] = session
        st.session_state["analysis_done"] = True
        st.session_state["screen"] = "trainer"
        st.session_state.pop("setup_loading", None)
        st.rerun()

    except ValueError as exc:
        _fail(str(exc))

    except Exception as exc:
        _fail(f"Unexpected error: {exc}")


# ── Screen 1: Setup ───────────────────────────────────────────────────────────

def screen_setup() -> None:
    """Render the setup screen where the user enters training parameters."""
    setup_loading: bool = st.session_state.get("setup_loading", False)
    setup_error: str | None = st.session_state.pop("setup_error", None)

    st.markdown("""
    <div class="chess-hero screen-fade">
      <span class="chess-hero-icon">♚</span>
      <div class="chess-hero-title">Chess Blunder Trainer</div>
      <div class="chess-hero-sub">Sharpen your tactics — one blunder at a time</div>
    </div>
    """, unsafe_allow_html=True)

    if setup_error:
        st.error(setup_error)

    # Reserve slot between hero and settings card for the loading status
    loading_slot = st.empty()

    default_username: str = st.session_state.get("username", "OrangeMutante")

    with st.container(border=True):
        st.markdown('<div class="form-section-header">Player</div>', unsafe_allow_html=True)

        col1, col2 = st.columns(2)

        with col1:
            username: str = st.text_input("Chess.com username", value=default_username, disabled=setup_loading)

        with col2:
            time_class: str = st.selectbox("Time control", ["rapid", "blitz", "bullet", "daily"], disabled=setup_loading)

        st.markdown('<div class="form-section-header">Analysis</div>', unsafe_allow_html=True)
        n_games: int = st.slider("Number of games to analyse", min_value=1, max_value=20, value=5, disabled=setup_loading)
        threshold: int = st.slider(
            "Blunder threshold (centipawn loss)",
            min_value=50,
            max_value=300,
            value=100,
            step=25,
            help="Moves with cp loss above this value are shown as blunders",
            disabled=setup_loading,
        )

        _cache = load_cache()
        _stats = get_cache_stats(_cache)
        if _stats["total_games"] > 0:
            st.markdown(
                f'<div style="margin-top:0.75rem">'
                f'<span class="cache-pill">'
                f'💾 {_stats["total_games"]} games cached'
                f' &nbsp;·&nbsp; {_stats["total_size_kb"]:.1f} KB'
                f' &nbsp;·&nbsp; last analysed {_stats["newest_entry"][:10]}'
                f'</span></div>',
                unsafe_allow_html=True,
            )

    if not setup_loading:
        st.markdown('<div style="height:0.75rem"></div>', unsafe_allow_html=True)
        _, col_btn, _ = st.columns([1, 2, 1])
        with col_btn:
            if st.button("Start Training →", type="primary", use_container_width=True):
                st.session_state["username"] = username
                st.session_state["time_class"] = time_class
                st.session_state["n_games"] = n_games
                st.session_state["threshold"] = threshold
                st.session_state["setup_loading"] = True
                st.rerun()

    if setup_loading:
        _do_setup_loading(loading_slot)


# ── Screen 2: Loading ─────────────────────────────────────────────────────────

def screen_loading() -> None:
    """Legacy loading screen — redirect to setup with loading state active."""
    # The loading pipeline now runs inline in screen_setup via setup_loading.
    # If session state somehow ends up on this screen, redirect gracefully.
    if st.session_state.get("analysis_done"):
        st.session_state["screen"] = "trainer"
        st.rerun()
        return

    if all(k in st.session_state for k in ("username", "time_class", "n_games", "threshold")):
        st.session_state["setup_loading"] = True
        st.session_state["screen"] = "setup"
        st.rerun()
        return

    _go_setup()



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
    st.session_state.pop(f"trainer_move_log_{current}", None)
    st.session_state.pop(f"trainer_pending_eval_{current}", None)
    st.session_state.pop(f"trainer_arrow_moves_{current}", None)
    # Discard any move the user dragged before resetting.
    st.session_state.pop("_board_captured_move", None)
    clear_pending_move()


def _render_move_log_html(move_log: list[dict], dark: bool) -> str:
    """Build styled HTML for the move feedback panel (always rendered)."""
    qcolors: dict[str, str] = _quality_colors(dark)
    muted: str = "#8a96aa" if dark else "#7a6e5e"
    parts: list[str] = ['<div class="panel-header">Move Feedback</div>']
    if not move_log:
        parts.append(
            f'<div style="color:{muted};font-size:0.78rem;font-style:italic;padding:0.4rem 0.25rem">'
            'Play a move to see feedback'
            '</div>'
        )
        return "".join(parts)
    for entry in move_log:
        if entry["classification"] is None:
            idle_border = "#3a4460" if dark else "rgba(0,0,0,0.15)"
            parts.append(
                f'<div class="move-log-entry" style="border-left-color:{idle_border};background:rgba(128,128,128,0.06)">'
                f'<span class="move-log-san">{entry["san"]}</span>'
                f'<span style="color:{muted};font-size:0.8rem">⏳</span>'
                f'</div>'
            )
        else:
            color: str = qcolors[entry["classification"]]
            bg: str    = _QUALITY_BG[entry["classification"]]
            label: str = _QUALITY_LABELS[entry["classification"]]
            parts.append(
                f'<div class="move-log-entry" style="border-left-color:{color};background:{bg}">'
                f'<span class="move-log-san">{entry["san"]}</span>'
                f'<span class="move-log-badge" style="background:{bg};color:{color};border:1px solid {color}33">{label}</span>'
                f'</div>'
            )
    return "".join(parts)


def screen_trainer(dark: bool) -> None:
    """Render the trainer loop: show one blunder at a time and capture the user's move."""
    session: dict = st.session_state["session"]
    blunder: dict | None = get_current_blunder(session)

    if blunder is None:
        st.session_state["screen"] = "summary"
        st.rerun()
        return

    total: int   = len(session["all_blunders"])
    current: int = session["current_position"]

    fen_key, eval_key, first_move_key, comp_idx_key = _trainer_state_keys(current)
    pending_sf_key: str   = f"trainer_pending_sf_{current}"
    pending_eval_key: str = f"trainer_pending_eval_{current}"
    move_log_key: str     = f"trainer_move_log_{current}"
    arrow_moves_key: str  = f"trainer_arrow_moves_{current}"

    bot_mode: bool = st.session_state.get("bot_mode", False)

    if fen_key not in st.session_state:
        initial_cp: int = evaluate_position(blunder["fen_before"])
        st.session_state[fen_key]         = blunder["fen_before"]
        st.session_state[eval_key]        = initial_cp
        st.session_state[first_move_key]  = None
        st.session_state[comp_idx_key]    = 0
        st.session_state[arrow_moves_key] = blunder["best_moves"]

    current_fen: str       = st.session_state[fen_key]
    current_eval: int      = st.session_state[eval_key]
    comp_idx: int          = st.session_state[comp_idx_key]
    first_move: str | None = st.session_state[first_move_key]
    show_arrows: bool = st.session_state.get("show_arrows", False)

    pending_sf: str | None = st.session_state.get(pending_sf_key)
    if pending_sf:
        board_tmp = chess.Board(current_fen)
        board_tmp.push(chess.Move.from_uci(pending_sf))
        st.session_state.pop(pending_sf_key, None)
        st.session_state[fen_key] = board_tmp.fen()

    # ── Header row: branding only ─────────────────────────────────────────────────
    muted_hdr: str    = "#8a96aa" if dark else "#7a6e5e"
    username_hdr: str = session.get("username", "")
    pct: float        = (current / total) * 100
    pb_track: str     = "#2d3650" if dark else "#e8dfc8"

    st.markdown(
        f'<div style="display:flex;align-items:center;gap:0.7rem;padding:0.05rem 0 0.4rem">'
        f'<span style="font-size:2.3rem;line-height:1;'
        f'filter:drop-shadow(0 2px 5px rgba(200,130,42,0.45))">♚</span>'
        f'<div>'
        f'<div style="font-size:1.3rem;font-weight:800;'
        f'background:linear-gradient(135deg,#e2a03f,#f1c46d);'
        f'-webkit-background-clip:text;-webkit-text-fill-color:transparent;'
        f'background-clip:text;line-height:1.2">Chess Blunder Trainer</div>'
        f'<div style="font-size:0.72rem;color:{muted_hdr};margin-top:0.12rem">'
        f'@{username_hdr} &nbsp;·&nbsp; '
        f'Game {blunder["game_index"] + 1}/{len(session["games"])} &nbsp;·&nbsp; '
        f'Blunder {current + 1}/{total}'
        f'</div></div></div>',
        unsafe_allow_html=True,
    )

    # Progress bar + divider
    st.markdown(
        f'<div style="width:100%;height:6px;background:{pb_track};border-radius:999px;'
        f'overflow:hidden;margin:0 0 0.6rem">'
        f'<div style="height:6px;width:{pct:.1f}%;'
        f'background:linear-gradient(90deg,#c8822a,#e2a03f,#f1c46d);'
        f'border-radius:999px;transition:width 0.3s ease"></div>'
        f'</div>',
        unsafe_allow_html=True,
    )

    # Blunder alert
    cp_display: str = _cap_cp_loss(blunder["cp_loss"])
    st.markdown(
        f'<div class="blunder-alert">'
        f'<span class="blunder-alert-icon">⚠️</span>'
        f'<span class="blunder-alert-text">'
        f'In this game you played <strong>{blunder["move_san"]}</strong> — '
        f'a blunder (cp loss: {cp_display}). '
        f'<em>What would you have played instead?</em>'
        f'</span>'
        f'</div>',
        unsafe_allow_html=True,
    )

    col_board, col_buttons = st.columns([4, 1])

    with col_buttons:
        # Navigation controls at the top of the sidebar
        st.markdown('<div class="panel-header">Navigation</div>', unsafe_allow_html=True)
        c_menu, c_mode = st.columns(2)
        with c_menu:
            if st.button("← Menu", use_container_width=True, key="hdr_menu_btn"):
                _go_setup(keep_username=True)
        with c_mode:
            mode_label: str = "Analysis" if bot_mode else "vs Bot"
            if st.button(mode_label, use_container_width=True, key="hdr_mode_btn"):
                st.session_state["bot_mode"] = not bot_mode
                st.rerun()

        sf_depth: int = st.slider(
            "Depth",
            min_value=5,
            max_value=20,
            value=10,
            step=1,
            key="sf_response_depth",
            help="Stockfish search depth — 10 is fast, 15 matches game analysis",
        )

        st.markdown('<hr class="section-divider">', unsafe_allow_html=True)

        # Move log — analysis mode only
        if not bot_mode:
            move_log: list[dict] = st.session_state.get(move_log_key, [])
            st.markdown(_render_move_log_html(move_log, dark), unsafe_allow_html=True)
            st.markdown('<hr class="section-divider">', unsafe_allow_html=True)

        st.markdown('<div class="panel-header">Options</div>', unsafe_allow_html=True)
        arrow_label: str = "Hide Arrows" if show_arrows else "Show Arrows"
        if st.button(arrow_label, use_container_width=True):
            st.session_state["show_arrows"] = not show_arrows
            st.rerun()

        if st.button("Reset Position", use_container_width=True):
            _clean_trainer_state(current, comp_idx)
            st.rerun()

        st.markdown('<hr class="section-divider">', unsafe_allow_html=True)

        st.markdown('<div class="panel-header">Actions</div>', unsafe_allow_html=True)
        if first_move is None:
            if st.button("Skip →", use_container_width=True):
                session["current_position"] += 1
                _clean_trainer_state(current, comp_idx)
                st.rerun()
        else:
            if st.button("Next →", type="primary", use_container_width=True):
                submit_attempt(session, first_move)
                _clean_trainer_state(current, comp_idx)
                st.rerun()

    # Hide arrows during bot-move animation to avoid stale arrow positions.
    in_bot_animation: bool = bot_mode and pending_sf is not None
    show_now: bool = show_arrows and not in_bot_animation

    with col_board:
        user_move: str | None = render_chess_component(
            fen=current_fen,
            orientation=blunder["color"],
            best_moves=st.session_state.get(arrow_moves_key, blunder["best_moves"]),
            cp_score=current_eval,
            key=f"trainer_{current}_{comp_idx}",
            interactive=True,
            show_arrows=show_now,
            autoplay_move=pending_sf if bot_mode else None,
        )

    pending_eval: dict | None = st.session_state.get(pending_eval_key)
    if pending_eval and not bot_mode:
        cp_loss, classification, eval_white = evaluate_move_quality(
            pending_eval["fen_before"], pending_eval["uci"], depth=sf_depth
        )
        log: list[dict] = st.session_state.get(move_log_key, [])
        for entry in log:
            if entry["uci"] == pending_eval["uci"] and entry["classification"] is None:
                entry["cp_loss"] = cp_loss
                entry["classification"] = classification
                break
        st.session_state[eval_key] = eval_white
        st.session_state.pop(pending_eval_key, None)
        # Recompute arrows for the current position after the user's move.
        new_arrow_moves = get_best_moves_for_fen(current_fen, n_best=5, depth=sf_depth)
        st.session_state[arrow_moves_key] = new_arrow_moves
        st.rerun()

    if user_move:
        if st.session_state[first_move_key] is None:
            st.session_state[first_move_key] = user_move

        board: chess.Board = chess.Board(current_fen)
        move_obj = chess.Move.from_uci(user_move)
        san: str = board.san(move_obj)
        board.push(move_obj)
        fen_after_user: str = board.fen()

        if bot_mode:
            with st.spinner("♟ Stockfish is thinking..."):
                if not board.is_game_over():
                    sf_move, new_eval = get_response_and_eval(fen_after_user, depth=sf_depth)
                else:
                    sf_move, new_eval = None, current_eval

            # Compute arrows for the position the user will play from after the bot responds.
            if sf_move:
                board_after_sf = chess.Board(fen_after_user)
                board_after_sf.push(chess.Move.from_uci(sf_move))
                fen_after_sf = board_after_sf.fen()
                if not board_after_sf.is_game_over():
                    new_arrow_moves = get_best_moves_for_fen(fen_after_sf, n_best=5, depth=sf_depth)
                else:
                    new_arrow_moves = []
            else:
                new_arrow_moves = []

            st.session_state[arrow_moves_key] = new_arrow_moves
            st.session_state[fen_key]         = fen_after_user
            st.session_state[eval_key]        = new_eval
            st.session_state[pending_sf_key]  = sf_move
            st.session_state.pop(f"move_input_trainer_{current}_{comp_idx}", None)
            st.session_state[comp_idx_key]    = comp_idx + 1
            st.rerun()
        else:
            log = st.session_state.get(move_log_key, [])
            log.append({
                "uci": user_move,
                "san": san,
                "cp_loss": None,
                "classification": None,
                "fen_before": current_fen,
            })
            st.session_state[move_log_key]    = log
            st.session_state[pending_eval_key] = {
                "uci": user_move,
                "san": san,
                "fen_before": current_fen,
            }
            st.session_state[fen_key]       = fen_after_user
            st.session_state.pop(f"move_input_trainer_{current}_{comp_idx}", None)
            st.session_state[comp_idx_key]  = comp_idx + 1
            st.rerun()


# ── Screen 4: Reveal ──────────────────────────────────────────────────────────

def screen_reveal() -> None:
    """Render feedback for the last submitted move."""
    session: dict    = st.session_state["session"]
    last_result: dict = st.session_state["last_result"]

    prev_index: int = session["current_position"] - 1
    blunder: dict   = session["all_blunders"][prev_index]

    if last_result["was_correct"]:
        st.markdown("""
        <div class="verdict-card-correct screen-fade">
          <span class="verdict-icon">✓</span>
          <div class="verdict-title-correct">Correct!</div>
          <div class="verdict-sub-correct">That was one of the best moves.</div>
        </div>
        """, unsafe_allow_html=True)
    else:
        st.markdown("""
        <div class="verdict-card-wrong screen-fade">
          <span class="verdict-icon">✗</span>
          <div class="verdict-title-wrong">Not quite</div>
          <div class="verdict-sub-wrong">Here's what happened and what was best.</div>
        </div>
        """, unsafe_allow_html=True)

    board_for_display = chess.Board(blunder["fen_before"])
    user_san: str    = board_for_display.san(chess.Move.from_uci(last_result["uci_played"]))
    blunder_san: str = board_for_display.san(chess.Move.from_uci(last_result["uci_blunder"]))
    cp_display: str  = _cap_cp_loss(last_result["cp_loss"])

    col1, col2 = st.columns(2)

    with col1:
        st.markdown(
            f'<div class="move-compare-card">'
            f'<div class="move-compare-label">You played</div>'
            f'<span class="move-compare-san">{user_san}</span>'
            f'</div>',
            unsafe_allow_html=True,
        )

    with col2:
        st.markdown(
            f'<div class="move-compare-card">'
            f'<div class="move-compare-label">In the game</div>'
            f'<span class="move-compare-san">{blunder_san}</span>'
            f'<span class="blunder-badge">Blunder &nbsp;·&nbsp; &minus;{cp_display} cp</span>'
            f'</div>',
            unsafe_allow_html=True,
        )

    best_sans: list[str] = []
    for uci in last_result["best_moves"]:
        try:
            best_sans.append(board_for_display.san(chess.Move.from_uci(uci)))
        except ValueError:
            best_sans.append(uci)

    pills_html: str = "".join(f'<span class="best-move-pill">{s}</span>' for s in best_sans)
    st.markdown(
        f'<div class="best-moves-section">'
        f'<div class="best-moves-label">Stockfish best moves</div>'
        f'<div class="best-moves-pills">{pills_html}</div>'
        f'</div>',
        unsafe_allow_html=True,
    )

    cp_after: int = last_result["cp_loss"] if blunder["color"] == "black" else -last_result["cp_loss"]

    render_chess_component(
        fen=blunder["fen_before"],
        orientation=blunder["color"],
        best_moves=last_result["best_moves"],
        cp_score=cp_after,
        key=f"reveal_{session['current_position']}",
        interactive=False,
        show_arrows=True,
    )

    if st.button("Next Blunder →", type="primary", use_container_width=True):
        st.session_state["screen"] = "trainer"
        st.rerun()


# ── Screen 5: Summary ─────────────────────────────────────────────────────────

def screen_summary() -> None:
    """Render the end-of-session summary with stats and navigation."""
    session: dict     = st.session_state["session"]
    stats: dict       = get_summary(session)
    games: list[dict] = session["games"]

    accuracy: float = stats["accuracy_pct"]
    if accuracy >= 70:
        trophy = "🏆"
        sub    = "Excellent session!"
    elif accuracy >= 40:
        trophy = "🥈"
        sub    = "Good effort — keep training!"
    else:
        trophy = "📈"
        sub    = "Every blunder reviewed is progress."

    st.markdown(
        f'<div class="summary-hero screen-fade">'
        f'<span class="summary-icon">{trophy}</span>'
        f'<div class="summary-title">Session Complete</div>'
        f'<div class="summary-sub">{sub}</div>'
        f'</div>',
        unsafe_allow_html=True,
    )

    col1, col2, col3 = st.columns(3)

    with col1:
        st.markdown(
            f'<div class="stat-card">'
            f'<div class="stat-accent-bar" style="background:#e2a03f"></div>'
            f'<div class="stat-number">{stats["total_reviewed"]}</div>'
            f'<div class="stat-label">Blunders reviewed</div>'
            f'</div>',
            unsafe_allow_html=True,
        )

    with col2:
        st.markdown(
            f'<div class="stat-card">'
            f'<div class="stat-accent-bar" style="background:#22c55e"></div>'
            f'<div class="stat-number">{stats["correct"]}</div>'
            f'<div class="stat-label">Correct moves</div>'
            f'</div>',
            unsafe_allow_html=True,
        )

    with col3:
        st.markdown(
            f'<div class="stat-card">'
            f'<div class="stat-accent-bar" style="background:#60a5fa"></div>'
            f'<div class="stat-number">{stats["accuracy_pct"]:.0f}%</div>'
            f'<div class="stat-label">Accuracy</div>'
            f'</div>',
            unsafe_allow_html=True,
        )

    st.markdown('<br>', unsafe_allow_html=True)

    if games:
        worst_idx: int = stats["worst_game_index"]
        best_idx: int  = stats["best_game_index"]

        col_w, col_b = st.columns(2)

        with col_w:
            worst_url: str = games[worst_idx].get("url", "—")
            st.markdown(
                f'<div class="game-stat-row">'
                f'<div class="game-stat-type">⚡ Worst game (most blunders)</div>'
                f'<div class="game-stat-link">{worst_url}</div>'
                f'</div>',
                unsafe_allow_html=True,
            )

        with col_b:
            best_url: str = games[best_idx].get("url", "—")
            st.markdown(
                f'<div class="game-stat-row">'
                f'<div class="game-stat-type">⭐ Best game (fewest blunders)</div>'
                f'<div class="game-stat-link">{best_url}</div>'
                f'</div>',
                unsafe_allow_html=True,
            )

    st.markdown('<br>', unsafe_allow_html=True)

    col_again, col_change = st.columns(2)

    with col_again:
        if st.button("Train Again →", type="primary", use_container_width=True):
            _go_setup(keep_username=False)

    with col_change:
        if st.button("Change Settings →", use_container_width=True):
            _go_setup(keep_username=True)


# ── App entry point ───────────────────────────────────────────────────────────

def main() -> None:
    """Route to the correct screen based on session_state["screen"]."""
    st.set_page_config(page_title="Chess Blunder Trainer", page_icon="♟", layout="wide")

    dark_mode: bool = st.session_state.get("dark_mode", False)
    _inject_global_css(dark_mode)

    if "screen" not in st.session_state:
        st.session_state["screen"] = "setup"

    # Theme toggle — top-right pill button
    _, tcol = st.columns([22, 2])
    with tcol:
        toggle_label: str = "☀️ Light" if dark_mode else "🌙 Dark"
        if st.button(toggle_label, key="_theme_toggle", use_container_width=True):
            st.session_state["dark_mode"] = not dark_mode
            st.rerun()

    screen: str = st.session_state["screen"]

    if screen == "setup":
        screen_setup()
    elif screen == "loading":
        screen_loading()
    elif screen == "trainer":
        screen_trainer(dark_mode)
    elif screen == "summary":
        screen_summary()
    else:
        st.session_state["screen"] = "setup"
        st.rerun()


if __name__ == "__main__":
    main()
