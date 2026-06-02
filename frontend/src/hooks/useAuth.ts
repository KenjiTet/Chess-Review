/** Auth store — tracks whether the user is logged in, a guest, or unauthenticated. */

import { create } from 'zustand';
import useFavorites from './useFavorites';
import useReviewed from './useReviewed';
import useSettings from './useSettings';

const AUTH_STORAGE_KEY = 'recall_auth';

interface StoredAuth {
  username: string | undefined;
  isGuest: boolean;
  token: string | undefined;
  isAdmin: boolean;
}

interface AuthState {
  username: string | undefined;
  isGuest: boolean;
  token: string | undefined;
  isAdmin: boolean;

  login: (username: string, token: string, isAdmin: boolean) => void;
  loginAsGuest: () => void;
  logout: () => void;
  getNamespace: () => string;
  getToken: () => string | undefined;
}

function loadStoredAuth(): StoredAuth {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);

    if (!stored) {
      return { username: undefined, isGuest: false, token: undefined, isAdmin: false };
    }

    return JSON.parse(stored) as StoredAuth;
  } catch {
    return { username: undefined, isGuest: false, token: undefined, isAdmin: false };
  }
}

function persistAuth(username: string | undefined, isGuest: boolean, token: string | undefined, isAdmin: boolean): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ username, isGuest, token, isAdmin }));
}

const useAuth = create<AuthState>((set, get) => ({
  ...loadStoredAuth(),

  login: (username, token, isAdmin) => {
    persistAuth(username, false, token, isAdmin);
    set({ username, isGuest: false, token, isAdmin });

    const ns = username;
    useSettings.getState().reloadForUser(ns);
    useFavorites.getState().reloadForUser(ns);
    useReviewed.getState().reloadForUser(ns);
  },

  loginAsGuest: () => {
    persistAuth(undefined, true, undefined, false);
    set({ username: undefined, isGuest: true, token: undefined, isAdmin: false });

    const ns = 'guest';
    useSettings.getState().reloadForUser(ns);
    useFavorites.getState().reloadForUser(ns);
    useReviewed.getState().reloadForUser(ns);
  },

  logout: () => {
    persistAuth(undefined, false, undefined, false);
    set({ username: undefined, isGuest: false, token: undefined, isAdmin: false });
  },

  getNamespace: () => {
    const { username, isGuest } = get();

    if (isGuest) {
      return 'guest';
    }

    return username ?? 'guest';
  },

  getToken: () => {
    return get().token;
  },
}));

export default useAuth;
