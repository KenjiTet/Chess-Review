/** Tracks which game URLs the current user has reviewed — persisted in the backend DB. */

import { create } from 'zustand';
import { fetchReviewedGames, markGamesReviewed } from '../api/client';

interface ReviewedState {
  reviewedUrls: Set<string>;

  /** Persist new URLs as reviewed (calls the backend, then updates local state). */
  markReviewed: (urls: string[]) => Promise<void>;

  /** Check if a game URL has been reviewed. */
  isReviewed: (url: string) => boolean;

  /** Load reviewed games from the backend for the authenticated user. */
  loadFromServer: () => Promise<void>;

  /** Clear local state (called on logout). */
  clear: () => void;
}

const useReviewed = create<ReviewedState>((set, get) => ({
  reviewedUrls: new Set<string>(),

  markReviewed: async (urls) => {
    // Optimistically update local state first
    const current = new Set(get().reviewedUrls);
    urls.forEach((u) => current.add(u));
    set({ reviewedUrls: current });

    try {
      await markGamesReviewed(urls);
    } catch {
      // Keep local state — the backend may be temporarily unavailable
    }
  },

  isReviewed: (url) => {
    return get().reviewedUrls.has(url);
  },

  loadFromServer: async () => {
    try {
      const result = await fetchReviewedGames();
      set({ reviewedUrls: new Set(result.game_urls) });
    } catch {
      set({ reviewedUrls: new Set() });
    }
  },

  clear: () => {
    set({ reviewedUrls: new Set() });
  },
}));

export default useReviewed;
