/**
 * Tracks which "Blunder of the Day" puzzles the user has solved, persisted to
 * localStorage and namespaced per user (mirrors useFavorites).
 *
 * A day is stored as its ISO date string ("YYYY-MM-DD") once the user plays a
 * best move for that day's puzzle. This drives the solved indicators, the total
 * solved count and the current solve streak on the hub.
 */

import { create } from 'zustand';

const BASE_KEY = 'recall_daily_solves';

let _currentKey: string = BASE_KEY;

function storageKey(namespace: string): string {
  return `${BASE_KEY}_${namespace}`;
}

function loadSolves(namespace?: string): string[] {
  try {
    const key = namespace ? storageKey(namespace) : _currentKey;
    const stored = localStorage.getItem(key);

    if (!stored) {
      return [];
    }

    return JSON.parse(stored) as string[];
  } catch {
    return [];
  }
}

function persistSolves(days: string[]): void {
  localStorage.setItem(_currentKey, JSON.stringify(days));
}

interface DailySolvesState {
  /** ISO date strings of solved days. */
  solvedDays: string[];
  markSolved: (day: string) => void;
  isSolved: (day: string) => boolean;
  reloadForUser: (namespace: string) => void;
}

const useDailySolves = create<DailySolvesState>((set, get) => ({
  solvedDays: loadSolves(),

  markSolved: (day) => {
    if (get().solvedDays.includes(day)) {
      return;
    }

    const updated = [...get().solvedDays, day];
    persistSolves(updated);
    set({ solvedDays: updated });
  },

  isSolved: (day) => {
    return get().solvedDays.includes(day);
  },

  reloadForUser: (namespace) => {
    _currentKey = storageKey(namespace);
    const solvedDays = loadSolves(namespace);
    set({ solvedDays });
  },
}));

export default useDailySolves;
