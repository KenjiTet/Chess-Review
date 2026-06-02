/**
 * Hook for fetching Chess.com games on demand.
 * Manages its own loading/error state independently of the session store.
 */

import { useState } from 'react';
import { ApiError, getGames } from '../api/client';
import type { Game } from '../api/client';

interface UseChessComResult {
  games: Game[];
  loading: boolean;
  error: string | undefined;
  fetchGames: (username: string, timeClass: string, n: number) => Promise<void>;
}

function useChessCom(): UseChessComResult {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const fetchGames = async (username: string, timeClass: string, n: number): Promise<void> => {
    setLoading(true);
    setError(undefined);

    try {
      const result = await getGames(username, timeClass, n);
      setGames(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to fetch games.');
      }
    } finally {
      setLoading(false);
    }
  };

  return { games, loading, error, fetchGames };
}

export default useChessCom;
