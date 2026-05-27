"""HTTP bridge for capturing chess moves from the JS board into Python."""

from http.server import HTTPServer, BaseHTTPRequestHandler
import threading
import json

_move_store: dict[str, str | None] = {"move": None}
_server_started: bool = False


class _Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        data = json.loads(body)
        _move_store["move"] = data.get("move", "")
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def do_OPTIONS(self) -> None:
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format: str, *args: object) -> None:
        # Suppress server logs
        pass


def start_bridge() -> None:
    """Start the move bridge HTTP server (no-op if already started)."""
    global _server_started
    if _server_started:
        return
    _server_started = True
    server = HTTPServer(("localhost", 5173), _Handler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()


def read_and_clear_move() -> str | None:
    """Return the last posted move and clear it, or None if no move pending."""
    move = _move_store.get("move")
    if move:
        _move_store["move"] = None
        return move
    return None
