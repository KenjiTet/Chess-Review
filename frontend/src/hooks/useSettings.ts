/** Persistent app-level settings stored in localStorage, namespaced per user. */

import { create } from 'zustand';

interface Settings {
  darkMode: boolean;
  nGames: number;
  threshold: number;
}

interface SettingsState extends Settings {
  setDarkMode: (v: boolean) => void;
  setNGames: (v: number) => void;
  setThreshold: (v: number) => void;
  reloadForUser: (namespace: string) => void;
}

const BASE_KEY = 'recall_settings';

const DEFAULTS: Settings = {
  darkMode: true,
  nGames: 1,
  threshold: 300,
};

let _currentKey: string = BASE_KEY;

function storageKey(namespace?: string): string {
  if (!namespace) {
    return _currentKey;
  }

  return `${BASE_KEY}_${namespace}`;
}

function loadSettings(namespace?: string): Settings {
  try {
    const key = storageKey(namespace);
    const stored = localStorage.getItem(key);

    if (stored) {
      return { ...DEFAULTS, ...(JSON.parse(stored) as Partial<Settings>) };
    }

    // Migrate the old standalone darkMode key if present
    const legacyDark = localStorage.getItem('darkMode');

    return {
      ...DEFAULTS,
      darkMode: legacyDark !== null ? legacyDark === 'true' : true,
    };
  } catch {
    return DEFAULTS;
  }
}

function persist(s: Settings): void {
  localStorage.setItem(_currentKey, JSON.stringify(s));
}

const useSettings = create<SettingsState>((set, get) => ({
  ...loadSettings(),

  setDarkMode: (darkMode) => {
    set({ darkMode });
    persist({ ...get(), darkMode });
  },

  setNGames: (nGames) => {
    set({ nGames });
    persist({ ...get(), nGames });
  },

  setThreshold: (threshold) => {
    set({ threshold });
    persist({ ...get(), threshold });
  },

  reloadForUser: (namespace) => {
    _currentKey = storageKey(namespace);
    const settings = loadSettings(namespace);
    set({ ...settings });
  },
}));

export default useSettings;
