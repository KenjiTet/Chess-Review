"""Chess.com Public API client — direct port of chess-trainer/api.py."""

import requests

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
        raise requests.RequestException(f"Failed to fetch profile for '{username}': {exc}") from exc


def get_player_stats(username: str) -> dict:
    """Fetch a player's game statistics (ratings) from Chess.com.

    Args:
        username: Chess.com username.

    Returns:
        Raw stats dict. Keys include chess_rapid, chess_blitz, chess_bullet,
        each containing a 'last' sub-dict with a 'rating' key.

    Raises:
        ValueError: If the username is not found (404).
        requests.RequestException: On network or HTTP errors.
    """
    url: str = f"{BASE_URL}/player/{username.lower()}/stats"

    try:
        response = requests.get(url, headers=HEADERS, timeout=10)

        if response.status_code == 404:
            raise ValueError(f"Chess.com username '{username}' not found.")

        response.raise_for_status()
        return response.json()

    except requests.RequestException as exc:
        raise requests.RequestException(f"Failed to fetch stats for '{username}': {exc}") from exc


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
        raise requests.RequestException(f"Failed to fetch archives for '{username}': {exc}") from exc


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
        raise requests.RequestException(f"Failed to fetch games from '{url}': {exc}") from exc


def get_game_by_url(username: str, game_url: str) -> dict:
    """Find a specific game by its Chess.com URL, scanning archives newest-first.

    Args:
        username: Chess.com username.
        game_url: The exact URL of the game (e.g. https://www.chess.com/game/live/123).

    Returns:
        The game dict from the Chess.com archive.

    Raises:
        ValueError: If the game is not found in any of the player's monthly archives.
        requests.RequestException: On network errors.
    """
    archives: list[str] = get_player_archives(username)

    for archive_url in archives:
        try:
            games: list[dict] = get_games_from_url(archive_url)
        except requests.RequestException:
            # A single month can 404/error transiently (e.g. an empty current
            # month the archives index still lists). Skip it rather than abort the
            # whole scan so the game can still be found in an older archive.
            continue

        for game in reversed(games):
            if game.get("url") == game_url:
                return game

    raise ValueError(f"Game '{game_url}' not found in any archive for '{username}'.")


def get_recent_games_all(username: str, n: int) -> list[dict]:
    """Fetch the n most recent games of any time class, newest-first.

    Args:
        username: Chess.com username.
        n: Number of games to fetch.

    Returns:
        List of up to n most recent game dicts across all time classes.
    """
    archives: list[str] = get_player_archives(username)
    collected: list[dict] = []

    for archive_url in archives:
        if len(collected) >= n:
            break

        try:
            games: list[dict] = get_games_from_url(archive_url)
        except requests.RequestException:
            # Skip a month that fails to fetch (e.g. an empty current month that
            # still 404s) instead of aborting — otherwise one bad archive makes a
            # player look like they have no recent games, stalling their backfill.
            continue

        for game in reversed(games):
            if len(collected) >= n:
                break
            collected.append(game)

    return collected


def get_top_blitz_gms(n: int) -> list[str]:
    """Fetch the usernames of the top Grandmasters on the live blitz leaderboard.

    Chess.com exposes no FIDE-rating leaderboard, so the platform's live blitz
    leaderboard is used as the "best players" proxy. Only Grandmasters (title
    "GM") are kept, ranked by their leaderboard score (blitz rating), highest
    first.

    Args:
        n: Maximum number of GM usernames to return.

    Returns:
        Up to n GM usernames, strongest first. Empty list on any API error.
    """
    url: str = f"{BASE_URL}/leaderboards"

    try:
        response = requests.get(url, headers=HEADERS, timeout=10)
        response.raise_for_status()
        data: dict = response.json()

    except requests.RequestException:
        # A leaderboard fetch failure must never crash the daily worker.
        return []

    # The live_blitz array is already ordered by rank, but we sort defensively
    # by score so ordering never depends on the API preserving rank order.
    blitz_entries: list[dict] = data.get("live_blitz", [])
    gm_entries: list[dict] = [
        entry
        for entry in blitz_entries
        if entry.get("title") == "GM"
    ]
    gm_entries.sort(key=lambda entry: entry.get("score", 0), reverse=True)

    usernames: list[str] = [
        entry["username"]
        for entry in gm_entries
        if entry.get("username")
    ]

    return usernames[:n]


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
