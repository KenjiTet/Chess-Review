"""User-stats aggregation — the data behind the full stats dashboard.

The dashboard mixes cheap DB aggregates (games analysed, W/L/D, review activity)
with heavy move-level rollups (blunder type repartition, game-phase / colour /
severity breakdowns) that require re-scanning every analysed game's cached
move_data. Re-scanning on every panel open is wasteful, so the heavy payload is
cached per (account, handle) in user_stats_cache and only recomputed when a
content signature derived from the analysed/reviewed tables changes.

Section A (platform ratings/records) is NOT computed here — it comes live from
the Chess.com API in the router, since it covers all played games rather than the
analysed subset.
"""

import json
from datetime import datetime, timezone

from services.analysis_store import CANONICAL_THRESHOLD
from services.cache import get_cached_game
from services.categorize import categorize_from_eval, derive_mover_evals
from services.db import get_connection
from services.stockfish import find_blunders

# Display categories the move-level rollup buckets blunders into. Kept in sync
# with frontend/src/constants/blunderCategories.ts (plus the fallbacks).
_CATEGORY_KEYS: tuple[str, ...] = (
    "missed_mate",
    "allowed_mate",
    "material_loss",
    "missed_gain",
    "positional",
    "uncategorized",
)

# Fullmove boundaries separating opening / middlegame / endgame.
_OPENING_MAX_FULLMOVE: int = 10
_MIDDLEGAME_MAX_FULLMOVE: int = 30

# Centipawn-loss bucket boundaries for the severity breakdown.
_SEVERITY_MID: int = 500
_SEVERITY_HIGH: int = 900


def compute_signature(username_lower: str, handle_lower: str) -> str:
    """Return a cheap content signature for the user's analysed/reviewed data.

    The signature changes whenever a game is (re)analysed or a review is recorded,
    which is exactly when the cached stats payload becomes stale. Computing it is a
    handful of indexed aggregates, far cheaper than the full recompute it guards.

    Args:
        username_lower: Lowercased account username.
        handle_lower: Lowercased linked platform handle the stats are scoped to.
    """
    with get_connection() as conn:
        analysed = conn.execute(
            """
            SELECT COUNT(*) AS n, COALESCE(MAX(analysed_at), '') AS last
            FROM user_analysed_games
            WHERE username_lower = ? AND LOWER(handle) = ?
            """,
            (username_lower, handle_lower),
        ).fetchone()

        reviewed = conn.execute(
            """
            SELECT COUNT(*) AS n,
                   COALESCE(MAX(reviewed_at), '') AS last,
                   COALESCE(SUM(positions_drilled), 0) AS drilled
            FROM user_reviewed_games
            WHERE username_lower = ?
            """,
            (username_lower,),
        ).fetchone()

    return f"{analysed['n']}:{analysed['last']}:{reviewed['n']}:{reviewed['last']}:{reviewed['drilled']}"


def _phase_for_move_index(move_index: int) -> str:
    """Return the game phase ("opening"/"middlegame"/"endgame") for a ply index.

    move_index is a 0-based ply index, so the fullmove number is index // 2 + 1.

    Args:
        move_index: 0-based index of the blunder move within move_data.
    """
    fullmove: int = move_index // 2 + 1

    if fullmove <= _OPENING_MAX_FULLMOVE:
        return "opening"

    if fullmove <= _MIDDLEGAME_MAX_FULLMOVE:
        return "middlegame"

    return "endgame"


def _severity_bucket(cp_loss: int) -> str:
    """Return the severity bucket key for a blunder's centipawn loss.

    Args:
        cp_loss: Centipawn loss of the blunder.
    """
    if cp_loss < _SEVERITY_MID:
        return "minor"

    if cp_loss < _SEVERITY_HIGH:
        return "major"

    return "critical"


def _resolve_blunder_category(
    move_data: list[dict],
    categories_per_blunder: dict,
    move_index: int,
) -> str:
    """Resolve a blunder's stored category, falling back for legacy cached games.

    New games store the engine-derived category per move index. Legacy rows have an
    empty map, so we fall back to the eval-only mate categories and finally to
    "uncategorized" rather than dropping the blunder from the rollup.

    Args:
        move_data: Output of analyze_game() for the game.
        categories_per_blunder: Stored {str(move_index) -> category} map.
        move_index: Index of the blunder move.
    """
    stored: str | None = categories_per_blunder.get(str(move_index))

    if stored:
        return stored

    eval_before_mover, eval_after_mover = derive_mover_evals(move_data, move_index)
    mate_category: str | None = categorize_from_eval(eval_before_mover, eval_after_mover)

    if mate_category is not None:
        return mate_category

    return "uncategorized"


def _empty_payload() -> dict:
    """Return the zeroed stats payload used when the user has no analysed games."""
    return {
        "training": {
            "games_analysed": 0,
            "games_analysed_by_class": {},
            "total_blunders": 0,
            "avg_blunders": None,
            "avg_blunders_by_class": {},
            "wins": 0,
            "draws": 0,
            "losses": 0,
            "win_rate": None,
            "clean_games": 0,
            "most_blunders_in_game": 0,
            "analysed_by_month": {},
        },
        "engagement": {
            "games_reviewed": 0,
            "positions_drilled": 0,
            "review_coverage": None,
            "drill_rate": None,
            "current_review_streak": 0,
            "longest_review_streak": 0,
        },
        "blunder_types": {key: 0 for key in _CATEGORY_KEYS},
        "phases": {"opening": 0, "middlegame": 0, "endgame": 0},
        "colors": {"white": 0, "black": 0},
        "severity": {"minor": 0, "major": 0, "critical": 0},
        "avg_cp_loss": None,
    }


def _compute_review_streaks(reviewed_dates: list[str]) -> tuple[int, int]:
    """Return (current_streak, longest_streak) in days from review timestamps.

    A streak counts consecutive calendar days with at least one reviewed game. The
    current streak only counts when the most recent review is today or yesterday.

    Args:
        reviewed_dates: ISO reviewed_at timestamps (any order).
    """
    days: set = set()

    for raw in reviewed_dates:
        try:
            days.add(datetime.fromisoformat(raw).date())
        except (ValueError, TypeError):
            # Skip unparseable timestamps rather than break the whole streak calc.
            continue

    if not days:
        return 0, 0

    ordered = sorted(days)
    longest: int = 1
    run: int = 1

    for i in range(1, len(ordered)):
        gap: int = (ordered[i] - ordered[i - 1]).days

        if gap == 1:
            run += 1
        elif gap > 1:
            run = 1

        longest = max(longest, run)

    today = datetime.now(timezone.utc).date()
    last_day = ordered[-1]
    current: int = 0

    if (today - last_day).days <= 1:
        # Walk backwards from the most recent review day while days stay contiguous.
        current = 1
        for i in range(len(ordered) - 1, 0, -1):
            if (ordered[i] - ordered[i - 1]).days == 1:
                current += 1
            else:
                break

    return current, longest


def compute_full_stats(username_lower: str, handle_lower: str) -> dict:
    """Compute the full analysed-game stats payload (sections B–E of the catalogue).

    Iterates every analysed game for the (account, handle), pulls its cached
    move_data + stored categories, and rolls up training activity, the blunder-type
    repartition, and the game-phase / colour / severity breakdowns. Only the
    player's own blunders (matching player_color) are counted, mirroring how the
    stored blunder_count is recorded.

    Args:
        username_lower: Lowercased account username.
        handle_lower: Lowercased linked platform handle the stats are scoped to.
    """
    with get_connection() as conn:
        game_rows = conn.execute(
            """
            SELECT game_url, time_class, player_color, result, blunder_count, end_time
            FROM user_analysed_games
            WHERE username_lower = ? AND LOWER(handle) = ?
            """,
            (username_lower, handle_lower),
        ).fetchall()

        reviewed_rows = conn.execute(
            "SELECT reviewed_at, positions_drilled FROM user_reviewed_games WHERE username_lower = ?",
            (username_lower,),
        ).fetchall()

    if not game_rows:
        payload = _empty_payload()
        # Engagement still has data even with no analysed games (e.g. favourites drilled).
        _fill_engagement(payload, reviewed_rows, total_blunders=0, games_analysed=0)
        return payload

    payload = _empty_payload()
    training = payload["training"]
    blunder_types = payload["blunder_types"]
    phases = payload["phases"]
    colors = payload["colors"]
    severity = payload["severity"]

    games_by_class: dict[str, int] = {}
    blunders_by_class: dict[str, int] = {}
    cp_loss_sum: int = 0
    cp_loss_count: int = 0

    for row in game_rows:
        time_class: str = row["time_class"]
        player_color: str = row["player_color"]
        result: str = row["result"]

        training["games_analysed"] += 1
        games_by_class[time_class] = games_by_class.get(time_class, 0) + 1

        if result == "win":
            training["wins"] += 1
        elif result == "draw":
            training["draws"] += 1
        else:
            training["losses"] += 1

        # Bucket the analysed-games trend by month (YYYY-MM) from the game end time.
        if row["end_time"]:
            month_key: str = datetime.fromtimestamp(row["end_time"], tz=timezone.utc).strftime("%Y-%m")
            training["analysed_by_month"][month_key] = training["analysed_by_month"].get(month_key, 0) + 1

        try:
            cached = get_cached_game({}, row["game_url"])
        except (TypeError, KeyError):
            # Game recorded but its evals are no longer cached — count it toward
            # games-analysed but skip the move-level rollup for it.
            continue

        move_data: list[dict] = cached["move_data"]
        categories_per_blunder: dict = cached["categories_per_blunder"]

        blunders = find_blunders(move_data, min_cp_loss=CANONICAL_THRESHOLD)
        own_blunders = [b for b in blunders if b.get("color") == player_color]

        game_blunder_count: int = len(own_blunders)
        training["total_blunders"] += game_blunder_count
        blunders_by_class[time_class] = blunders_by_class.get(time_class, 0) + game_blunder_count

        if game_blunder_count == 0:
            training["clean_games"] += 1

        training["most_blunders_in_game"] = max(training["most_blunders_in_game"], game_blunder_count)

        for blunder in own_blunders:
            move_index: int = blunder["move_index"]
            cp_loss: int = blunder.get("cp_loss", 0)

            category: str = _resolve_blunder_category(move_data, categories_per_blunder, move_index)
            if category not in blunder_types:
                category = "uncategorized"
            blunder_types[category] += 1

            phases[_phase_for_move_index(move_index)] += 1
            colors[player_color] += 1
            severity[_severity_bucket(cp_loss)] += 1

            cp_loss_sum += cp_loss
            cp_loss_count += 1

    # Derived training aggregates.
    training["games_analysed_by_class"] = games_by_class

    if training["games_analysed"] > 0:
        training["avg_blunders"] = training["total_blunders"] / training["games_analysed"]
        training["win_rate"] = training["wins"] / training["games_analysed"] * 100

    training["avg_blunders_by_class"] = {
        tc: blunders_by_class.get(tc, 0) / count
        for tc, count in games_by_class.items()
    }

    if cp_loss_count > 0:
        payload["avg_cp_loss"] = cp_loss_sum / cp_loss_count

    _fill_engagement(
        payload,
        reviewed_rows,
        total_blunders=training["total_blunders"],
        games_analysed=training["games_analysed"],
    )

    return payload


def _fill_engagement(payload: dict, reviewed_rows: list, total_blunders: int, games_analysed: int) -> None:
    """Populate the engagement section (reviews, drills, coverage, streaks) in place.

    Args:
        payload: The stats payload being built (mutated in place).
        reviewed_rows: user_reviewed_games rows with reviewed_at / positions_drilled.
        total_blunders: Total player blunders detected (denominator for drill rate).
        games_analysed: Total analysed games (denominator for review coverage).
    """
    engagement = payload["engagement"]

    games_reviewed: int = len(reviewed_rows)
    positions_drilled: int = sum(row["positions_drilled"] or 0 for row in reviewed_rows)

    engagement["games_reviewed"] = games_reviewed
    engagement["positions_drilled"] = positions_drilled

    if games_analysed > 0:
        engagement["review_coverage"] = games_reviewed / games_analysed * 100

    if total_blunders > 0:
        engagement["drill_rate"] = positions_drilled / total_blunders * 100

    current, longest = _compute_review_streaks([row["reviewed_at"] for row in reviewed_rows])
    engagement["current_review_streak"] = current
    engagement["longest_review_streak"] = longest


def get_full_stats(username_lower: str, handle_lower: str) -> dict:
    """Return the cached stats payload, recomputing only when the signature changed.

    Args:
        username_lower: Lowercased account username.
        handle_lower: Lowercased linked platform handle the stats are scoped to.
    """
    signature: str = compute_signature(username_lower, handle_lower)

    with get_connection() as conn:
        cached = conn.execute(
            "SELECT signature, payload FROM user_stats_cache WHERE username_lower = ? AND handle = ?",
            (username_lower, handle_lower),
        ).fetchone()

    if cached is not None and cached["signature"] == signature:
        return json.loads(cached["payload"])

    payload: dict = compute_full_stats(username_lower, handle_lower)
    now_iso: str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    with get_connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO user_stats_cache
                (username_lower, handle, signature, payload, computed_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (username_lower, handle_lower, signature, json.dumps(payload), now_iso),
        )
        conn.commit()

    return payload
