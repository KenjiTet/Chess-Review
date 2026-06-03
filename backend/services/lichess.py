"""Lichess Public API client — mirrors chess_com.py interface."""

import json

import requests

BASE_URL: str = "https://lichess.org"
HEADERS: dict[str, str] = {
    "User-Agent": "chess-blunder-trainer/1.0 contact@gmail.com",
    "Accept": "application/json",
}

# Lichess perf type → internal time_class
_PERF_TO_TC: dict[str, str] = {
    "bullet": "bullet",
    "blitz": "blitz",
    "rapid": "rapid",
    "classical": "daily",
    "correspondence": "daily",
    "ultraBullet": "bullet",
}

# Internal time_class → Lichess perf type (for API queries)
_TC_TO_PERF: dict[str, str] = {
    "bullet": "bullet",
    "blitz": "blitz",
    "rapid": "rapid",
    "daily": "correspondence",
}

# Lichess game statuses that count as a draw
_DRAW_STATUSES: frozenset[str] = frozenset({
    "draw", "stalemate", "cheat",
})


def _map_result(game: dict, color: str) -> str:
    """Return "win", "lose", or "draw" for a given color in a Lichess game dict."""
    winner: str | None = game.get("winner")
    status: str = game.get("status", "")

    if status in _DRAW_STATUSES or (winner is None and status not in ("mate", "resign", "timeout", "outoftime", "variantEnd", "noStart")):
        return "draw"

    if winner == color:
        return "win"

    if winner is not None:
        return "lose"

    # Ambiguous — treat as draw
    return "draw"


def _map_game(game: dict) -> dict:
    """Convert a Lichess game JSON object to the internal game dict shape."""
    perf: str = game.get("perf", "blitz")
    time_class: str = _PERF_TO_TC.get(perf, "blitz")

    players: dict = game.get("players", {})
    white_player: dict = players.get("white", {})
    black_player: dict = players.get("black", {})

    white_user: dict = white_player.get("user", {})
    black_user: dict = black_player.get("user", {})

    white_result: str = _map_result(game, "white")
    black_result: str = _map_result(game, "black")

    game_id: str = game.get("id", "")

    # Lichess accuracy is available under players.white.analysis.accuracy (requires ?accuracy=true)
    white_acc: float | None = white_player.get("analysis", {}).get("accuracy") if white_player.get("analysis") else None
    black_acc: float | None = black_player.get("analysis", {}).get("accuracy") if black_player.get("analysis") else None

    accuracies: dict = {}
    if white_acc is not None:
        accuracies["white"] = white_acc
    if black_acc is not None:
        accuracies["black"] = black_acc

    return {
        "url": f"https://lichess.org/{game_id}",
        "pgn": game.get("pgn", ""),
        "time_class": time_class,
        "white": {
            "username": white_user.get("name", ""),
            "rating": white_player.get("rating", 0),
            "result": white_result,
        },
        "black": {
            "username": black_user.get("name", ""),
            "rating": black_player.get("rating", 0),
            "result": black_result,
        },
        "end_time": game.get("lastMoveAt", 0) // 1000,
        "accuracies": accuracies,
    }


def get_player_profile(username: str) -> dict:
    """Fetch a player's public profile from Lichess.

    Args:
        username: Lichess username.

    Returns:
        Raw profile dict from the API.

    Raises:
        ValueError: If the username is not found (404).
        requests.RequestException: On network or HTTP errors.
    """
    url: str = f"{BASE_URL}/api/user/{username.lower()}"

    try:
        response = requests.get(url, headers=HEADERS, timeout=10)

        if response.status_code == 404:
            raise ValueError(f"Lichess username '{username}' not found.")

        response.raise_for_status()
        return response.json()

    except requests.RequestException as exc:
        raise requests.RequestException(f"Failed to fetch Lichess profile for '{username}': {exc}") from exc


def _fetch_games_ndjson(username: str, params: dict) -> list[dict]:
    """Fetch games from Lichess NDJSON stream and return a list of mapped game dicts."""
    url: str = f"{BASE_URL}/api/games/user/{username.lower()}"

    # Lichess returns NDJSON — one JSON object per line
    stream_headers: dict[str, str] = {**HEADERS, "Accept": "application/x-ndjson"}

    try:
        response = requests.get(url, headers=stream_headers, params=params, timeout=30)
        response.raise_for_status()

        games: list[dict] = []
        for line in response.text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                game = json.loads(line)
                mapped = _map_game(game)
                if mapped.get("pgn"):
                    games.append(mapped)
            except (json.JSONDecodeError, KeyError):
                continue

        return games

    except requests.RequestException as exc:
        raise requests.RequestException(f"Failed to fetch Lichess games for '{username}': {exc}") from exc


def get_recent_games(username: str, time_class: str, n: int) -> list[dict]:
    """Fetch the n most recent games of a given time class for a Lichess player.

    Args:
        username: Lichess username.
        time_class: One of "rapid", "blitz", "bullet", "daily".
        n: Number of games to fetch.

    Returns:
        List of up to n most recent matching game dicts, most recent first.
    """
    perf: str = _TC_TO_PERF.get(time_class, time_class)

    params: dict = {
        "max": n,
        "perfType": perf,
        "pgnInJson": "true",
        "moves": "true",
        "clocks": "true",
        "opening": "false",
    }

    return _fetch_games_ndjson(username, params)


def get_recent_games_all(username: str, n: int) -> list[dict]:
    """Fetch the n most recent games of any time class for a Lichess player.

    Args:
        username: Lichess username.
        n: Number of games to fetch.

    Returns:
        List of up to n most recent game dicts across all time classes.
    """
    params: dict = {
        "max": n,
        "pgnInJson": "true",
        "moves": "true",
        "clocks": "true",
        "opening": "false",
    }

    return _fetch_games_ndjson(username, params)


def get_game_by_url(username: str, game_url: str) -> dict:
    """Fetch a specific Lichess game by its URL.

    Args:
        username: Lichess username (unused for Lichess but kept for API parity).
        game_url: Lichess game URL (e.g. https://lichess.org/AbCdEfGh).

    Returns:
        Mapped game dict in the internal shape.

    Raises:
        ValueError: If the game is not found.
        requests.RequestException: On network errors.
    """
    # Extract game ID from URL — last path segment
    game_id: str = game_url.rstrip("/").split("/")[-1]

    url: str = f"{BASE_URL}/game/export/{game_id}"
    params: dict = {
        "pgnInJson": "true",
        "moves": "true",
        "clocks": "true",
        "opening": "false",
    }

    try:
        response = requests.get(url, headers=HEADERS, params=params, timeout=15)

        if response.status_code == 404:
            raise ValueError(f"Lichess game '{game_url}' not found.")

        response.raise_for_status()
        game: dict = response.json()
        return _map_game(game)

    except requests.RequestException as exc:
        raise requests.RequestException(f"Failed to fetch Lichess game '{game_url}': {exc}") from exc
