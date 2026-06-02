/** Auth store — tracks whether the user is logged in, a guest, or unauthenticated. */

import { create } from 'zustand';
import useFavorites from './useFavorites';
import useReviewed from './useReviewed';
import useSettings from './useSettings';

const AUTH_STORAGE_KEY = 'recall_auth';

interface AuthState {
  username: string | undefined;
  isGuest: boolean;

  login: (username: string) => void;
  loginAsGuest: () => void;
  logout: () => void;
  getNamespace: () => string;
}

function loadStoredAuth(): { username: string | undefined; isGuest: boolean } {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);

    if (!stored) {
      return { username: undefined, isGuest: false };
    }

    return JSON.parse(stored) as { username: string | undefined; isGuest: boolean };
  } catch {
    return { username: undefined, isGuest: false };
  }
}

function persistAuth(username: string | undefined, isGuest: boolean): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ username, isGuest }));
}

const useAuth = create<AuthState>((set, get) => ({
  ...loadStoredAuth(),

  login: (username) => {
    persistAuth(username, false);
    set({ username, isGuest: false });

    const ns = username;
    useSettings.getState().reloadForUser(ns);
    useFavorites.getState().reloadForUser(ns);
    useReviewed.getState().reloadForUser(ns);
  },

  loginAsGuest: () => {
    persistAuth(undefined, true);
    set({ username: undefined, isGuest: true });

    const ns = 'guest';
    useSettings.getState().reloadForUser(ns);
    useFavorites.getState().reloadForUser(ns);
    useReviewed.getState().reloadForUser(ns);
  },

  logout: () => {
    persistAuth(undefined, false);
    set({ username: undefined, isGuest: false });
  },

  getNamespace: () => {
    const { username, isGuest } = get();

    if (isGuest) {
      return 'guest';
    }

    return username ?? 'guest';
  },
}));

export default useAuth;
