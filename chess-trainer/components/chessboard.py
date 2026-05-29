"""Interactive chessboard rendered via st.components.v1.html() with HTTP move bridge."""

import json
import streamlit as st
import streamlit.components.v1 as components
from components.move_bridge import start_bridge, read_and_clear_move, clear_pending_move


@st.fragment(run_every=0.5)
def _poll_bridge_fragment() -> None:
    """Auto-rerun every 0.5 s; trigger a full app rerun the moment a move arrives."""
    move = read_and_clear_move()
    if move:
        st.session_state["_board_captured_move"] = move
        st.rerun(scope="app")


def render_chess_component(
    fen: str,
    orientation: str,
    best_moves: list[str],
    cp_score: int,
    key: str = "chessboard",
    interactive: bool = True,
    show_arrows: bool = False,
    autoplay_move: str | None = None,
    last_move_uci: str | None = None,
    intro_move: str | None = None,
    intro_fen: str | None = None,
) -> str | None:
    """Render an interactive chessboard.

    When interactive=True, returns the UCI move string once the user drags a
    piece; returns None until then. When interactive=False, always returns None.

    intro_move / intro_fen: when set on the first render of a new position,
    the board snaps to intro_fen and then animates to fen after 500 ms so the
    opponent's last move plays out visually before the user can interact.
    last_move_uci: UCI of the last move played — its source square is highlighted.
    """
    start_bridge()

    if not interactive:
        _render_board_html(
            fen, orientation, best_moves, cp_score, show_arrows,
            None, key, interactive=False,
            last_move_uci=last_move_uci,
        )
        return None

    # Consume any move that the polling fragment captured on a previous fragment rerun.
    move: str | None = st.session_state.pop("_board_captured_move", None)

    _render_board_html(
        fen, orientation, best_moves, cp_score, show_arrows,
        autoplay_move, key, interactive=True,
        last_move_uci=last_move_uci,
        intro_move=intro_move,
        intro_fen=intro_fen,
    )

    # Polling fragment: auto-reruns every 0.5 s so a drag is noticed within half a second.
    _poll_bridge_fragment()

    return move


def _render_board_html(
    fen: str,
    orientation: str,
    best_moves: list[str],
    cp_score: int,
    show_arrows: bool,
    autoplay_move: str | None,
    key: str,
    interactive: bool,
    last_move_uci: str | None = None,
    intro_move: str | None = None,
    intro_fen: str | None = None,
) -> None:
    """Build and inject the board HTML into the Streamlit page."""
    capped = max(-500, min(500, cp_score))
    white_pct = max(5, min(95, (capped + 500) / 1000 * 100))
    black_pct = 100 - white_pct

    if abs(cp_score) >= 900:
        score_text = "M"
    elif cp_score > 0:
        score_text = f"+{cp_score/100:.1f}"
    else:
        score_text = f"{cp_score/100:.1f}"

    label_color = "#f0ebe0" if black_pct > 50 else "#2a2520"

    params = json.dumps({
        "fen": fen,
        "orientation": orientation,
        "bestMoves": best_moves,
        "showArrows": show_arrows,
        "autoplayMove": autoplay_move or "",
        "interactive": interactive,
        "lastMoveUci": last_move_uci or "",
        "introMove": intro_move or "",
        "introFen": intro_fen or "",
    })

    html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<link rel="stylesheet" href="https://unpkg.com/@chrisoakman/chessboardjs@1.0.0/dist/chessboard-1.0.0.min.css">
<script src="https://unpkg.com/@chrisoakman/chessboardjs@1.0.0/dist/chessboard-1.0.0.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.2/chess.js"></script>
<style>
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ background: transparent; overflow: hidden; }}
.white-1e1d7 {{ background-color: #e8c99a !important; }}
.black-3c85d {{ background-color: #9c6932 !important; }}
#wrapper {{ display: flex; flex-direction: row; align-items: flex-start; justify-content: center; gap: 6px; padding: 4px; }}
#eval-bar {{ width: 28px; height: 560px; border-radius: 6px; overflow: hidden; display: flex; flex-direction: column; position: relative; border: 1px solid rgba(0,0,0,0.12); flex-shrink: 0; }}
#eval-black {{ background: #2a2520; height: {black_pct:.1f}%; transition: height 0.4s ease; }}
#eval-white {{ background: #f0ebe0; flex: 1; }}
#eval-label {{ position: absolute; width: 100%; text-align: center; top: 50%; transform: translateY(-50%); font-size: 9px; font-weight: bold; color: {label_color}; pointer-events: none; }}
#board-container {{ position: relative; width: 560px; height: 560px; }}
#board {{ width: 560px; }}
#arrow-canvas {{ position: absolute; top: 0; left: 0; pointer-events: none; z-index: 10; }}
#sf-overlay {{ display: none; position: absolute; bottom: 0; left: 0; right: 0; background: rgba(15,23,42,0.92); color: #f1c46d; font-size: 13px; font-weight: 700; text-align: center; padding: 8px; z-index: 20; border-radius: 0 0 4px 4px; border-top: 1px solid rgba(226,160,63,0.3); letter-spacing: 0.03em; }}
/* Yellow glow on the source square of the last played move */
.highlight-source {{ background: rgba(255, 210, 0, 0.50) !important; box-shadow: inset 0 0 16px 5px rgba(255, 210, 0, 0.55) !important; }}
</style>
</head>
<body>
<div id="wrapper">
  <div id="eval-bar">
    <div id="eval-black"></div>
    <div id="eval-white"></div>
    <div id="eval-label">{score_text}</div>
  </div>
  <div id="board-container">
    <div id="board" style="width:560px"></div>
    <canvas id="arrow-canvas" width="560" height="560"></canvas>
    <div id="sf-overlay">&#9823; Stockfish is responding...</div>
  </div>
</div>
<script>
var P = {params};
var board = null;
var game = null;
var BOARD_SIZE = 560;
// Blocks user drags during the intro animation window.
var introPlaying = false;

function highlightSourceSquare(sq) {{
  document.querySelectorAll('.highlight-source').forEach(function(el) {{
    el.classList.remove('highlight-source');
  }});
  if (!sq) return;
  var el = document.querySelector('[data-square="' + sq + '"]');
  if (el) {{
    el.classList.add('highlight-source');
  }}
}}

function squareToXY(sq) {{
  var col = sq.charCodeAt(0) - 97;
  var row = parseInt(sq[1]) - 1;
  var sqSize = BOARD_SIZE / 8;
  var x, y;
  if (P.orientation === "white") {{
    x = col * sqSize + sqSize / 2;
    y = (7 - row) * sqSize + sqSize / 2;
  }} else {{
    x = (7 - col) * sqSize + sqSize / 2;
    y = row * sqSize + sqSize / 2;
  }}
  return {{x: x, y: y}};
}}

function drawArrow(ctx, from, to, color, width, headLen) {{
  var f = squareToXY(from), t = squareToXY(to);
  var dx = t.x - f.x, dy = t.y - f.y;
  var angle = Math.atan2(dy, dx);
  var len = Math.sqrt(dx*dx + dy*dy);
  var sx = f.x + Math.cos(angle)*(len - headLen*0.7);
  var sy = f.y + Math.sin(angle)*(len - headLen*0.7);
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = width; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(sx, sy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(t.x, t.y);
  ctx.lineTo(t.x - headLen*Math.cos(angle-Math.PI/6), t.y - headLen*Math.sin(angle-Math.PI/6));
  ctx.lineTo(t.x - headLen*Math.cos(angle+Math.PI/6), t.y - headLen*Math.sin(angle+Math.PI/6));
  ctx.closePath(); ctx.fill(); ctx.restore();
}}

function drawArrows() {{
  var canvas = document.getElementById("arrow-canvas");
  var ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);
  if (!P.showArrows) return;
  var widths   = [18, 14, 11, 8, 6];
  var alphas   = [0.90, 0.78, 0.65, 0.52, 0.40];
  var headLens = [32, 28, 23, 20, 16];
  var limit = Math.min(P.bestMoves.length, 5);
  for (var i = 0; i < limit; i++) {{
    var move = P.bestMoves[i];
    if (move && move.length >= 4) {{
      var color = "rgba(59,130,246," + alphas[i] + ")";
      drawArrow(ctx, move.slice(0,2), move.slice(2,4), color, widths[i], headLens[i]);
    }}
  }}
}}

function sendMove(uci) {{
  fetch("http://localhost:5173", {{
    method: "POST",
    headers: {{"Content-Type": "application/json"}},
    body: JSON.stringify({{move: uci}})
  }}).catch(function(e) {{ console.error("Bridge error:", e); }});
}}

$(document).ready(function() {{
  game = new Chess(P.fen);

  // When intro is active, start board at introFen so the animation begins
  // from the correct position and there is no flash of the blunder position.
  var startPos = (P.introMove && P.introFen) ? P.introFen : P.fen;

  var config = {{
    position: startPos,
    orientation: P.orientation,
    pieceTheme: "https://chessboardjs.com/img/chesspieces/wikipedia/{{piece}}.png",
    draggable: P.interactive,
    onDrop: function(source, target) {{
      if (introPlaying) return "snapback";
      var move = game.move({{from: source, to: target, promotion: "q"}});
      if (move === null) return "snapback";
      highlightSourceSquare(source);
      sendMove(source + target);
    }}
  }};
  board = Chessboard("board", config);
  setTimeout(drawArrows, 250);

  // Static source-square highlight — shown only when no intro animation is pending.
  if (P.lastMoveUci && P.lastMoveUci.length >= 4 && !P.introMove) {{
    setTimeout(function() {{
      highlightSourceSquare(P.lastMoveUci.slice(0, 2));
    }}, 80);
  }}

  // Bot autoplay (Stockfish response in bot mode).
  if (P.autoplayMove && P.autoplayMove.length >= 4) {{
    var overlay = document.getElementById("sf-overlay");
    overlay.style.display = "block";
    setTimeout(function() {{
      var from = P.autoplayMove.slice(0, 2);
      var to   = P.autoplayMove.slice(2, 4);
      var result = game.move({{from: from, to: to, promotion: "q"}});
      if (result) {{
        board.position(game.fen(), true);
        highlightSourceSquare(from);
      }}
      setTimeout(function() {{ overlay.style.display = "none"; }}, 600);
    }}, 400);
  }}

  // Intro animation: replay the opponent's last move before the blunder.
  // The board was initialised at introFen; after the delay it animates to fen.
  if (P.introMove && P.introMove.length >= 4 && P.introFen) {{
    introPlaying = true;
    var introFrom = P.introMove.slice(0, 2);
    setTimeout(function() {{
      board.position(P.fen, true);
      // Highlight source once the piece animation completes (~200 ms).
      setTimeout(function() {{
        highlightSourceSquare(introFrom);
        introPlaying = false;
      }}, 250);
    }}, 500);
  }}
}});
</script>
</body>
</html>"""

    components.html(html, height=582, scrolling=False)
