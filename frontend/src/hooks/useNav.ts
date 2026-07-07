/**
 * Zustand store for the authenticated menu's active section.
 *
 * The left sidebar (AppShell) drives this; SessionSetup reads it to decide which
 * panel to show. Replaces the old local showFavorites / showStats booleans so the
 * persistent sidebar and the setup content stay in sync.
 */

import { create } from 'zustand';

// The three menu views selectable from the sidebar. Settings and Admin are not
// sections — they are a separate screen and an admin toggle respectively.
export type MenuSection = 'recent' | 'saved' | 'stats';

// Time-control filter, shared between the sticky profile header (rating pills)
// and the setup content (Time Control select + recent games list).
export type TimeClass = 'all' | 'rapid' | 'blitz' | 'bullet' | 'daily';

const TIME_CLASSES: readonly TimeClass[] = ['all', 'rapid', 'blitz', 'bullet', 'daily'];
const TIME_CLASS_STORAGE_KEY = 'recall_time_class';

function getSavedTimeClass(): TimeClass {
  const saved = localStorage.getItem(TIME_CLASS_STORAGE_KEY);

  if (saved && (TIME_CLASSES as readonly string[]).includes(saved)) {
    return saved as TimeClass;
  }

  return 'all';
}

interface NavStore {
  section: MenuSection;
  setSection: (section: MenuSection) => void;
  timeClass: TimeClass;
  setTimeClass: (tc: TimeClass) => void;
}

const useNav = create<NavStore>((set) => ({
  // Recent games is the default landing view for the menu.
  section: 'recent',

  setSection: (section: MenuSection) => {
    set({ section });
  },

  // Persisted so the chosen time control survives reloads and screen changes.
  timeClass: getSavedTimeClass(),

  setTimeClass: (timeClass: TimeClass) => {
    set({ timeClass });
    localStorage.setItem(TIME_CLASS_STORAGE_KEY, timeClass);
  },
}));

export default useNav;
