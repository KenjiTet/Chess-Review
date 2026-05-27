"""Interactive chessboard rendered via st.components.v1.html() with HTTP move bridge."""

import json
import streamlit.components.v1 as components
from components.move_bridge import start_bridge, read_and_clear_move


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
    start_bridge()

    if not interactive:
        _render_board_html(fen, orientation, best_moves, blunder_move,
                           cp_score, show_arrows, autoplay_move, key,
                           interactive=False)
        return None

    # Check for a captured move from the bridge
    move = read_and_clear_move()

    _render_board_html(fen, orientation, best_moves, blunder_move,
                       cp_score, show_arrows, autoplay_move, key,
                       interactive=True)

    return move if move else None


def _render_board_html(
    fen: str,
    orientation: str,
    best_moves: list[str],
    blunder_move: str | None,
    cp_score: int,
    show_arrows: bool,
    autoplay_move: str | None,
    key: str,
    interactive: bool,
) -> None:
    """Build and inject the board HTML into the Streamlit page."""
    # Compute eval bar values
    capped = max(-500, min(500, cp_score))
    white_pct = max(5, min(95, (capped + 500) / 1000 * 100))
    black_pct = 100 - white_pct

    if abs(cp_score) >= 900:
        score_text = "M"
    elif cp_score > 0:
        score_text = f"+{cp_score/100:.1f}"
    else:
        score_text = f"{cp_score/100:.1f}"

    label_color = "#fff" if black_pct > 50 else "#000"

    params = json.dumps({
        "fen": fen,
        "orientation": orientation,
        "bestMoves": best_moves,
        "blunderMove": blunder_move or "",
        "showArrows": show_arrows,
        "autoplayMove": autoplay_move or "",
        "interactive": interactive,
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
.white-1e1d7 {{ background-color: #f0d9b5 !important; }}
.black-3c85d {{ background-color: #b58863 !important; }}
#wrapper {{ display: flex; flex-direction: row; align-items: flex-start; gap: 6px; padding: 4px; }}
#eval-bar {{ width: 40px; height: 560px; border-radius: 4px; overflow: hidden; display: flex; flex-direction: column; position: relative; border: 1px solid #555; flex-shrink: 0; }}
#eval-black {{ background: #1a1a1a; height: {black_pct:.1f}%; transition: height 0.4s ease; }}
#eval-white {{ background: #f0f0f0; flex: 1; }}
#eval-label {{ position: absolute; width: 100%; text-align: center; top: 50%; transform: translateY(-50%); font-size: 10px; font-weight: bold; color: {label_color}; pointer-events: none; }}
#board-container {{ position: relative; width: 560px; height: 560px; }}
#board {{ width: 560px; }}
#arrow-canvas {{ position: absolute; top: 0; left: 0; pointer-events: none; z-index: 10; }}
#sf-overlay {{ display: none; position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.65); color: #fff; font-size: 14px; font-weight: bold; text-align: center; padding: 8px; z-index: 20; border-radius: 0 0 4px 4px; }}
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

function drawArrow(ctx, from, to, color, width) {{
  var f = squareToXY(from), t = squareToXY(to);
  var dx = t.x - f.x, dy = t.y - f.y;
  var angle = Math.atan2(dy, dx);
  var headLen = 18;
  var len = Math.sqrt(dx*dx + dy*dy);
  var sx = f.x + Math.cos(angle)*(len - headLen*0.7);
  var sy = f.y + Math.sin(angle)*(len - headLen*0.7);
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = width; ctx.lineCap = "round"; ctx.globalAlpha = 0.82;
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
  if (P.blunderMove && P.blunderMove.length >= 4)
    drawArrow(ctx, P.blunderMove.slice(0,2), P.blunderMove.slice(2,4), "rgba(220,0,0,0.85)", 7);
  if (P.bestMoves.length > 1)
    drawArrow(ctx, P.bestMoves[1].slice(0,2), P.bestMoves[1].slice(2,4), "rgba(0,100,255,0.75)", 5);
  if (P.bestMoves.length > 0)
    drawArrow(ctx, P.bestMoves[0].slice(0,2), P.bestMoves[0].slice(2,4), "rgba(0,200,0,0.85)", 7);
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
  var config = {{
    position: P.fen,
    orientation: P.orientation,
    pieceTheme: "https://chessboardjs.com/img/chesspieces/wikipedia/{{piece}}.png",
    draggable: P.interactive,
    onDrop: function(source, target) {{
      var move = game.move({{from: source, to: target, promotion: "q"}});
      if (move === null) return "snapback";
      sendMove(source + target);
    }}
  }};
  board = Chessboard("board", config);
  setTimeout(drawArrows, 250);

  if (P.autoplayMove && P.autoplayMove.length >= 4) {{
    var overlay = document.getElementById("sf-overlay");
    overlay.style.display = "block";
    setTimeout(function() {{
      var from = P.autoplayMove.slice(0,2);
      var to = P.autoplayMove.slice(2,4);
      var result = game.move({{from: from, to: to, promotion: "q"}});
      if (result) board.position(game.fen(), true);
      setTimeout(function() {{ overlay.style.display = "none"; }}, 600);
    }}, 400);
  }}
}});
</script>
</body>
</html>"""

    components.html(html, height=590, scrolling=False)
