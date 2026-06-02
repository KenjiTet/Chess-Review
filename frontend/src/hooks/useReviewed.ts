/** Tracks which game URLs the current user has reviewed (completed a training session on). */

import { create } from 'zustand';

const BASE_KEY = 'recall_reviewed';

function storageKey(namespace: string): string {
  return `${BASE_KEY}_${namespace}`;
}

function loadReviewed(namespace: string): Set<string> {
  try {
    const stored = localStorage.getItem(storageKey(namespace));

    if (!stored) {
      return new Set();
    }

    return new Set(JSON.parse(stored) as string[]);
  } catch {
    return new Set();
  }
}

function persistReviewed(namespace: string, urls: Set<string>): void {
  localStorage.setItem(storageKey(namespace), JSON.stringify(Array.from(urls)));
}

interface ReviewedState {
  reviewedUrls: Set<string>;
  namespace: string;

  markReviewed: (urls: string[]) => void;
  isReviewed: (url: string) => boolean;
  reloadForUser: (namespace: string) => void;
}

const useReviewed = create<ReviewedState>((set, get) => ({
  reviewedUrls: new Set<string>(),
  namespace: 'guest',

  markReviewed: (urls) => {
    const current = new Set(get().reviewedUrls);
    urls.forEach((u) => current.add(u));
    persistReviewed(get().namespace, current);
    set({ reviewedUrls: current });
  },

  isReviewed: (url) => {
    return get().reviewedUrls.has(url);
  },

  reloadForUser: (namespace) => {
    const loaded = loadReviewed(namespace);
    set({ reviewedUrls: loaded, namespace });
  },
}));

export default useReviewed;
