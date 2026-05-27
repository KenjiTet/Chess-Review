"""Chess.com Public API client."""

import requests
from typing import Optional

BASE_URL: str = "https://api.chess.com/pub"
HEADERS: dict[str, str] = {"User-Agent": "chess-blunder-trainer/1.0 contact@gmail.com"}


def get_player_profile(username: str) -> dict:
    """Fetch a player's public profile from Chess.com.

    Args:
        username: Chess.com username.

    Returns:
        Raw profile dict from the API.

    Raises:
        ValueError: If the username is not found (404).
        requests.RequestException: On network or HTTP errors.
    """
    url: str = f"{BASE_URL}/player/{username.lower()}"

    try:
        response = requests.get(url, headers=HEADERS, timeout=10)

        if response.status_code == 404:
            raise ValueError(f"Chess.com username '{username}' not found.")

        response.raise_for_status()
        return response.json()

    except requests.RequestException as exc:
        raise requests.RequestException(
            f"Failed to fetch profile for '{username}': {exc}"
        ) from exc


def get_player_archives(username: str) -> list[str]:
    """Fetch all monthly archive URLs for a player, most recent first.

    Args:
        username: Chess.com username.

    Returns:
        List of monthly archive URLs, most recent first.
    """
    url: str = f"{BASE_URL}/player/{username.lower()}/games/archives"

    try:
        response = requests.get(url, headers=HEADERS, timeout=10)
        response.raise_for_status()
        data: dict = response.json()
        archives: list[str] = data.get("archives", [])
        # Reverse so index 0 is the most recent month
        return list(reversed(archives))

    except requests.RequestException as exc:
        raise requests.RequestException(
            f"Failed to fetch archives for '{username}': {exc}"
        ) from exc


def get_games_from_url(url: str) -> list[dict]:
    """Fetch all games from a monthly archive URL.

    Args:
        url: Chess.com monthly archive URL.

    Returns:
        List of game dicts from the archive.
    """
    try:
        response = requests.get(url, headers=HEADERS, timeout=30)
        response.raise_for_status()
        data: dict = response.json()
        return data.get("games", [])

    except requests.RequestException as exc:
        raise requests.RequestException(
            f"Failed to fetch games from '{url}': {exc}"
        ) from exc


def get_recent_games(username: str, time_class: str, n: int) -> list[dict]:
    """Fetch the n most recent games of a given time class for a player.

    Walks archives from most recent to oldest, filtering by time_class,
    and stops once n matching games have been collected.

    Args:
        username: Chess.com username.
        time_class: One of "rapid", "blitz", "bullet", "daily".
        n: Number of games to fetch.

    Returns:
        List of up to n most recent matching game dicts, most recent first.
        Each dict contains at least: pgn, time_class, url, white, black.
    """
    archives: list[str] = get_player_archives(username)
    collected: list[dict] = []

    for archive_url in archives:
        if len(collected) >= n:
            break

        games: list[dict] = get_games_from_url(archive_url)

        # Iterate from newest to oldest within the archive
        for game in reversed(games):
            if len(collected) >= n:
                break

            if game.get("time_class") == time_class:
                collected.append(game)

    return collected
