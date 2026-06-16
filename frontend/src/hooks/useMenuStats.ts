/**
 * Single source of truth for the menu's player stats.
 *
 * Both the desktop (`ProfileBand`) and mobile (ELO strip) menu layouts read
 * from this hook so they always display the *same* stats computed from the
 * *same* data. Previously each layout fetched/derived its own subset, which let
 * the displayed numbers drift apart between screen sizes.
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchUserProfile, fetchUserStats } from '../api/client';
import type { GameHistoryEntry, UserProfileResponse } from '../api/client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface MenuStats {
  /** Platform profile (ratings, avatar, joined year). Undefined until fetched. */
  ratings: UserProfileResponse | undefined;
  /** True while the profile fetch is in flight. */
  ratingsLoading: boolean;
  /** Win-rate over the last 30 days (0–100), undefined when no games loaded. */
  winRate30d: number | undefined;
  /** Loaded games already analysed by Stockfish (drives win-rate context). */
  gamesAnalysed: number;
  /** Total blunder positions drilled across all analysed games (DB-derived). */
  blundersDrilled: number;
  /** Average blunders per game for the selected time class (DB-derived). */
  avgBlunders: number | undefined;
}

/**
 * A single displayable stat. Both layouts iterate the *same* ordered array, so
 * the set of stats shown can never diverge between desktop and mobile — only
 * the surrounding markup/CSS differs.
 */
export interface MenuStatItem {
  /** Stable key for React lists. */
  key: string;
  /** Pre-formatted value string (e.g. "67%", "1.4", "—"). */
  value: string;
  /** Primary label line. */
  label: string;
  /** Secondary label line (desktop two-line labels). */
  sublabel: string;
  /** Compact single-line label for the mobile strip. */
  shortLabel: string;
}

export interface UseMenuStatsArgs {
  /** Linked platform handle used for profile/stats fetches. */
  playerUsername: string;
  /** "chesscom" | "lichess" — defaults applied by callers. */
  platform: string | undefined;
  /** Currently selected time-control filter. */
  timeClass: string;
  /** A registered account (has at least one linked handle). */
  isAccount: boolean;
  /** Guest session — no account-derived stats. */
  isGuest: boolean;
}

export interface UseMenuStatsResult {
  stats: MenuStats;
  /** Ordered, layout-independent list of the non-rating stats. */
  statItems: MenuStatItem[];
  /** Feed the loaded game list in to refresh win-rate / games-analysed. */
  setLoadedGames: (games: GameHistoryEntry[]) => void;
  /** Re-fetch the DB-derived stats (call after a game finishes analysing). */
  refreshStats: () => void;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ── Stat-item builder ──────────────────────────────────────────────────────

/**
 * Map the raw stats into the ordered display list. Centralised here so both
 * layouts render identical stats in identical order.
 */
function buildStatItems(stats: MenuStats): MenuStatItem[] {
  let winRateValue: string;

  if (stats.winRate30d !== undefined) {
    winRateValue = `${Math.round(stats.winRate30d)}%`;
  } else {
    winRateValue = '—';
  }

  let avgBlundersValue: string;

  if (stats.avgBlunders !== undefined) {
    avgBlundersValue = stats.avgBlunders.toFixed(1);
  } else {
    avgBlundersValue = '—';
  }

  return [
    {
      key: 'win-rate',
      value: winRateValue,
      label: 'Win rate',
      sublabel: 'Loaded Games',
      shortLabel: 'Win rate',
    },
    {
      key: 'blunders-drilled',
      value: String(stats.blundersDrilled),
      label: 'Blunders',
      sublabel: 'drilled',
      shortLabel: 'Drilled',
    },
    {
      key: 'avg-blunders',
      value: avgBlundersValue,
      label: 'Avg blunders',
      sublabel: 'per game',
      shortLabel: 'Avg blund.',
    },
  ];
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useMenuStats(args: UseMenuStatsArgs): UseMenuStatsResult {
  const { playerUsername, platform, timeClass, isAccount, isGuest } = args;

  const [ratings, setRatings] = useState<UserProfileResponse | undefined>(undefined);
  const [ratingsLoading, setRatingsLoading] = useState<boolean>(true);
  const [winRate30d, setWinRate30d] = useState<number | undefined>(undefined);
  const [gamesAnalysed, setGamesAnalysed] = useState<number>(0);
  const [blundersDrilled, setBlundersDrilled] = useState<number>(0);
  const [avgBlunders, setAvgBlunders] = useState<number | undefined>(undefined);

  // Fetch the platform profile (ratings + avatar). Single fetch shared by both layouts.
  useEffect(() => {
    if (!playerUsername) {
      return undefined;
    }

    let cancelled = false;
    setRatingsLoading(true);

    async function load(): Promise<void> {
      try {
        const result = await fetchUserProfile(playerUsername, platform ?? 'chesscom');

        if (!cancelled) {
          setRatings(result);
        }
      } catch {
        // Silently fail — ratings just won't show if the fetch fails.
      } finally {
        if (!cancelled) {
          setRatingsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [playerUsername, platform]);

  // DB-derived stats: blunders drilled (all time classes) and avg blunders per
  // game (filtered to the selected time class). Guests have no account.
  const refreshStats = useCallback((): void => {
    if (isGuest || !isAccount) {
      setBlundersDrilled(0);
      setAvgBlunders(undefined);
      return;
    }

    async function load(): Promise<void> {
      try {
        const stats = await fetchUserStats(timeClass);

        setBlundersDrilled(stats.blunders_drilled);
        setAvgBlunders(stats.avg_blunders ?? undefined);
      } catch {
        // Silently fail — stats stay at their previous values.
      }
    }

    void load();
  }, [isGuest, isAccount, timeClass]);

  // Re-fetch whenever the inputs change (time class switch, login, etc.).
  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // Loaded-games-derived stats: win rate over last 30 days + analysed count.
  const setLoadedGames = useCallback((games: GameHistoryEntry[]): void => {
    const now = Date.now();
    const recent = games.filter((g) => now - new Date(g.date).getTime() < THIRTY_DAYS_MS);

    let nextWinRate: number | undefined;

    if (recent.length > 0) {
      nextWinRate = (recent.filter((g) => g.result === 'win').length / recent.length) * 100;
    }

    const analysed = games.filter((g) => g.blunder_count !== null).length;

    setWinRate30d(nextWinRate);
    setGamesAnalysed(analysed);
  }, []);

  const stats: MenuStats = {
    ratings,
    ratingsLoading,
    winRate30d,
    gamesAnalysed,
    blundersDrilled,
    avgBlunders,
  };

  const statItems = buildStatItems(stats);

  return { stats, statItems, setLoadedGames, refreshStats };
}

export default useMenuStats;
