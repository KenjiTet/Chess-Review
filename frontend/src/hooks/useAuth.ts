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
  platform: string | undefined;
  avatar: string | undefined;
}

interface AuthState {
  username: string | undefined;
  isGuest: boolean;
  token: string | undefined;
  isAdmin: boolean;
  platform: string | undefined;
  avatar: string | undefined;

  login: (username: string, token: string, isAdmin: boolean, platform: string, avatar: string | undefined) => void;
  logout: () => void;
  getNamespace: () => string;
  getToken: () => string | undefined;
}

function loadStoredAuth(): StoredAuth {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);

    if (!stored) {
      return { username: undefined, isGuest: false, token: undefined, isAdmin: false, platform: undefined, avatar: undefined };
    }

    return JSON.parse(stored) as StoredAuth;
  } catch {
    return { username: undefined, isGuest: false, token: undefined, isAdmin: false, platform: undefined, avatar: undefined };
  }
}

function persistAuth(username: string | undefined, isGuest: boolean, token: string | undefined, isAdmin: boolean, platform: string | undefined, avatar: string | undefined): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ username, isGuest, token, isAdmin, platform, avatar }));
}

const useAuth = create<AuthState>((set, get) => ({
  ...loadStoredAuth(),

  login: (username, token, isAdmin, platform, avatar) => {
    persistAuth(username, false, token, isAdmin, platform, avatar);
    set({ username, isGuest: false, token, isAdmin, platform, avatar });

    const ns = username;
    useSettings.getState().reloadForUser(ns);
    useFavorites.getState().reloadForUser(ns);
    void useReviewed.getState().loadFromServer();
  },

  logout: () => {
    persistAuth(undefined, false, undefined, false, undefined, undefined);
    set({ username: undefined, isGuest: false, token: undefined, isAdmin: false, platform: undefined, avatar: undefined });
    useReviewed.getState().clear();
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
