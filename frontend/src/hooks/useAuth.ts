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
  chesscomUsername: string | undefined;
  lichessUsername: string | undefined;
  email: string | undefined;
  emailVerified: boolean;
  authProvider: string | undefined;
}

/** Optional linked handles + email details passed to login(). */
interface LoginExtra {
  chesscomUsername?: string | undefined;
  lichessUsername?: string | undefined;
  email?: string | undefined;
  emailVerified?: boolean;
  authProvider?: string | undefined;
}

interface AuthState {
  username: string | undefined;
  isGuest: boolean;
  token: string | undefined;
  isAdmin: boolean;
  platform: string | undefined;
  avatar: string | undefined;
  chesscomUsername: string | undefined;
  lichessUsername: string | undefined;
  email: string | undefined;
  emailVerified: boolean;
  authProvider: string | undefined;

  login: (username: string, token: string, isAdmin: boolean, platform: string, avatar: string | undefined, extra?: LoginExtra) => void;
  setLinks: (links: LoginExtra) => void;
  setEmailVerified: (verified: boolean) => void;
  /** Update the stored email after the user adds/changes it (resets verified state). */
  setAccountEmail: (email: string) => void;
  logout: () => void;
  getNamespace: () => string;
  getToken: () => string | undefined;
  /** Return the platform handle whose games should be fetched for the given platform.
   *  Logged-in accounts use their linked handle; guests fall back to the account username. */
  getPlatformUsername: (platform: string) => string | undefined;
}

function loadStoredAuth(): StoredAuth {
  const empty: StoredAuth = {
    username: undefined,
    isGuest: false,
    token: undefined,
    isAdmin: false,
    platform: undefined,
    avatar: undefined,
    chesscomUsername: undefined,
    lichessUsername: undefined,
    email: undefined,
    emailVerified: false,
    authProvider: undefined,
  };

  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);

    if (!stored) {
      return empty;
    }

    return { ...empty, ...(JSON.parse(stored) as Partial<StoredAuth>) };
  } catch {
    return empty;
  }
}

function persistAuth(state: StoredAuth): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state));
}

const useAuth = create<AuthState>((set, get) => ({
  ...loadStoredAuth(),

  login: (username, token, isAdmin, platform, avatar, extra) => {
    const next: StoredAuth = {
      username,
      isGuest: false,
      token,
      isAdmin,
      platform,
      avatar,
      chesscomUsername: extra?.chesscomUsername,
      lichessUsername: extra?.lichessUsername,
      email: extra?.email,
      emailVerified: extra?.emailVerified ?? false,
      authProvider: extra?.authProvider,
    };
    persistAuth(next);
    set(next);

    const ns = username;
    useSettings.getState().reloadForUser(ns);
    useFavorites.getState().reloadForUser(ns);
    void useReviewed.getState().loadFromServer();
  },

  setLinks: (links) => {
    const { chesscomUsername, lichessUsername } = get();
    const next = {
      chesscomUsername: links.chesscomUsername ?? chesscomUsername,
      lichessUsername: links.lichessUsername ?? lichessUsername,
    };
    set(next);

    const current = get();
    persistAuth({
      username: current.username,
      isGuest: current.isGuest,
      token: current.token,
      isAdmin: current.isAdmin,
      platform: current.platform,
      avatar: current.avatar,
      chesscomUsername: current.chesscomUsername,
      lichessUsername: current.lichessUsername,
      email: current.email,
      emailVerified: current.emailVerified,
      authProvider: current.authProvider,
    });
  },

  setEmailVerified: (verified) => {
    set({ emailVerified: verified });

    // Persist so the confirm-email banner stays cleared across reloads.
    const current = get();
    persistAuth({
      username: current.username,
      isGuest: current.isGuest,
      token: current.token,
      isAdmin: current.isAdmin,
      platform: current.platform,
      avatar: current.avatar,
      chesscomUsername: current.chesscomUsername,
      lichessUsername: current.lichessUsername,
      email: current.email,
      emailVerified: current.emailVerified,
      authProvider: current.authProvider,
    });
  },

  setAccountEmail: (email) => {
    // A newly set email is always unconfirmed until the link is clicked.
    set({ email, emailVerified: false });

    const current = get();
    persistAuth({
      username: current.username,
      isGuest: current.isGuest,
      token: current.token,
      isAdmin: current.isAdmin,
      platform: current.platform,
      avatar: current.avatar,
      chesscomUsername: current.chesscomUsername,
      lichessUsername: current.lichessUsername,
      email: current.email,
      emailVerified: current.emailVerified,
      authProvider: current.authProvider,
    });
  },

  logout: () => {
    const next: StoredAuth = {
      username: undefined,
      isGuest: false,
      token: undefined,
      isAdmin: false,
      platform: undefined,
      avatar: undefined,
      chesscomUsername: undefined,
      lichessUsername: undefined,
      email: undefined,
      emailVerified: false,
      authProvider: undefined,
    };
    persistAuth(next);
    set(next);
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

  getPlatformUsername: (platform) => {
    const { username, chesscomUsername, lichessUsername } = get();

    if (platform === 'lichess' && lichessUsername) {
      return lichessUsername;
    }

    if (platform === 'chesscom' && chesscomUsername) {
      return chesscomUsername;
    }

    // Guest / unlinked account — the account username doubles as the platform handle.
    return username;
  },
}));

export default useAuth;
