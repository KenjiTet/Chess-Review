/**
 * Shared menu data for the authenticated shell.
 *
 * The sticky ProfileHeader (rendered by AppShell) and the SessionSetup content
 * both need the same player profile, ratings and derived stats. Rather than
 * duplicate the fetches, the shell wraps its content in this provider so both
 * consume a single useMenuStats instance and a single shared time-control value.
 */

import { createContext, useContext } from 'react';
import type { JSX, ReactNode } from 'react';
import useAuth from '../../hooks/useAuth';
import useSettings from '../../hooks/useSettings';
import useNav from '../../hooks/useNav';
import type { TimeClass } from '../../hooks/useNav';
import useMenuStats from '../../hooks/useMenuStats';
import type { MenuStats, MenuStatItem } from '../../hooks/useMenuStats';
import type { GameHistoryEntry } from '../../api/client';

interface MenuDataValue {
  /** Linked platform handle driving profile/stats fetches. */
  playerUsername: string;
  platform: string | undefined;
  /** Account-store avatar (fallback when the profile fetch has none). */
  avatar: string | undefined;
  timeClass: TimeClass;
  setTimeClass: (tc: TimeClass) => void;
  menuStats: MenuStats;
  statItems: MenuStatItem[];
  setLoadedGames: (games: GameHistoryEntry[]) => void;
  refreshStats: () => void;
}

const MenuDataContext = createContext<MenuDataValue | undefined>(undefined);

export function MenuDataProvider({ children }: { children: ReactNode }): JSX.Element {
  const avatar = useAuth((s) => s.avatar);
  const platform = useAuth((s) => s.platform);
  const username = useAuth((s) => s.username);
  // Subscribe to the linked handles directly so relinking a different account (or
  // switching the active platform) re-derives playerUsername and re-fetches the
  // now-reset stats, instead of the provider holding on to the previous handle.
  const chesscomUsername = useAuth((s) => s.chesscomUsername);
  const lichessUsername = useAuth((s) => s.lichessUsername);
  const threshold = useSettings((s) => s.threshold);
  const timeClass = useNav((s) => s.timeClass);
  const setTimeClass = useNav((s) => s.setTimeClass);

  // The active platform selects which linked handle drives profile/stats/games.
  // Guests / unlinked accounts fall back to the account username as the handle.
  const activePlatform = platform ?? 'chesscom';
  let playerUsername = '';

  if (activePlatform === 'lichess') {
    playerUsername = lichessUsername ?? username ?? '';
  } else {
    playerUsername = chesscomUsername ?? username ?? '';
  }

  const { stats: menuStats, statItems, setLoadedGames, refreshStats } = useMenuStats({
    playerUsername,
    platform: activePlatform,
    timeClass,
    threshold,
  });

  const value: MenuDataValue = {
    playerUsername,
    platform: activePlatform,
    avatar,
    timeClass,
    setTimeClass,
    menuStats,
    statItems,
    setLoadedGames,
    refreshStats,
  };

  return <MenuDataContext.Provider value={value}>{children}</MenuDataContext.Provider>;
}

// Consumer hook — throws if used outside the provider so misuse is obvious.
export function useMenuData(): MenuDataValue {
  const ctx = useContext(MenuDataContext);

  if (ctx === undefined) {
    throw new Error('useMenuData must be used within a MenuDataProvider');
  }

  return ctx;
}
