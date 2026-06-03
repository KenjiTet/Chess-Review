/** Persistent saved positions stored in localStorage, namespaced per user. */

import { create } from 'zustand';

export interface FavoritePosition {
  id: string;
  date: string;
  fen: string;
  orientation: 'white' | 'black';
  blunderDescription: string;
  classification: string;
  cpLoss: number;
  moveSan: string;
  color: string;
  moveNumber: number;
  boardImageDataUrl: string;
  note?: string;
}

const BASE_KEY = 'recall_favorites';

let _currentKey: string = BASE_KEY;

function storageKey(namespace: string): string {
  return `${BASE_KEY}_${namespace}`;
}

function loadFavorites(namespace?: string): FavoritePosition[] {
  try {
    const key = namespace ? storageKey(namespace) : _currentKey;
    const stored = localStorage.getItem(key);

    if (!stored) {
      return [];
    }

    return JSON.parse(stored) as FavoritePosition[];
  } catch {
    return [];
  }
}

function persistFavorites(favorites: FavoritePosition[]): void {
  localStorage.setItem(_currentKey, JSON.stringify(favorites));
}

interface FavoritesState {
  favorites: FavoritePosition[];
  addFavorite: (position: Omit<FavoritePosition, 'id' | 'date'>) => void;
  removeFavorite: (id: string) => void;
  isFavorited: (fen: string) => boolean;
  reloadForUser: (namespace: string) => void;
}

const useFavorites = create<FavoritesState>((set, get) => ({
  favorites: loadFavorites(),

  addFavorite: (position) => {
    const newFav: FavoritePosition = {
      ...position,
      id: `fav-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: new Date().toISOString(),
    };
    const updated = [newFav, ...get().favorites];
    persistFavorites(updated);
    set({ favorites: updated });
  },

  removeFavorite: (id) => {
    const updated = get().favorites.filter((f) => f.id !== id);
    persistFavorites(updated);
    set({ favorites: updated });
  },

  isFavorited: (fen) => {
    return get().favorites.some((f) => f.fen === fen);
  },

  reloadForUser: (namespace) => {
    _currentKey = storageKey(namespace);
    const favorites = loadFavorites(namespace);
    set({ favorites });
  },
}));

export default useFavorites;
