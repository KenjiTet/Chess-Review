/**
 * Zustand store for the active training session.
 * Manages screen transitions and delegates all API calls to api/client.ts.
 */

import { create } from 'zustand';
import { ApiError, getBlunder, skipBlunder as apiSkipBlunder, streamBuildSession, submitAttempt as apiSubmitAttempt } from '../api/client';
import type { BlunderResponse, SessionCreateRequest } from '../api/client';
import useReviewed from './useReviewed';

export type Screen = 'login' | 'setup' | 'loading' | 'trainer';

interface SessionStore {
  sessionId: string | undefined;
  currentBlunder: BlunderResponse | undefined;
  screen: Screen;
  loadingPct: number;
  loadingStatus: string;
  /** Title shown on the loading screen — varies based on whether Stockfish will run. */
  loadingTitle: string;
  error: string | undefined;
  blunderCount: number;
  reviewedCount: number;
  /** True after all blunders in a session are reviewed — triggers the done modal. */
  sessionDone: boolean;
  /** Why the session ended — 'finished' = all reviewed, 'no_blunders' = none found. */
  sessionDoneReason: 'finished' | 'no_blunders' | undefined;
  /** The last request used to build a session, so the user can replay next game. */
  lastSessionRequest: SessionCreateRequest | undefined;

  buildSession: (req: SessionCreateRequest, loadingTitle?: string) => Promise<void>;
  fetchBlunder: () => Promise<void>;
  submitAttempt: (uciMove: string) => Promise<void>;
  skipBlunder: () => Promise<void>;
  loadFavoritePosition: (opts: {
    fen: string;
    color: string;
    moveSan: string;
    cpLoss: number;
    classification: string;
    moveNumber: number;
  }) => void;
  clearError: () => void;
  reset: () => void;
}

const useSession = create<SessionStore>((set, get) => ({
  sessionId: undefined,
  currentBlunder: undefined,
  screen: 'setup',
  loadingPct: 0,
  loadingStatus: '',
  loadingTitle: 'Analysing your games…',
  error: undefined,
  blunderCount: 0,
  reviewedCount: 0,
  sessionDone: false,
  sessionDoneReason: undefined,
  lastSessionRequest: undefined,

  buildSession: async (req: SessionCreateRequest, loadingTitle?: string) => {
    set({
      screen: 'loading',
      loadingPct: 0,
      loadingStatus: 'Starting...',
      loadingTitle: loadingTitle ?? 'Analysing your games…',
      error: undefined,
      sessionDone: false,
      lastSessionRequest: req,
    });

    try {
      const response = await streamBuildSession(req, (event) => {
        set({ loadingPct: event.pct, loadingStatus: event.status });
      });

      localStorage.setItem('recall_last_blunder_count', String(response.blunder_count));

      set({
        sessionId: response.session_id,
        blunderCount: response.blunder_count,
        reviewedCount: 0,
      });

      // Store game URLs so they can be marked reviewed when the session ends.
      sessionStorage.setItem('recall_pending_game_urls', JSON.stringify(response.game_urls ?? []));

      await get().fetchBlunder();
    } catch (err) {
      if (err instanceof ApiError) {
        set({ screen: 'setup', error: err.message });
      } else {
        set({ screen: 'setup', error: 'An unexpected error occurred.' });
      }
    }
  },

  fetchBlunder: async () => {
    const { sessionId, screen } = get();

    if (!sessionId) {
      return;
    }

    try {
      const blunder = await getBlunder(sessionId);

      if (blunder === undefined) {
        // All blunders reviewed — mark game URLs as reviewed then return to menu.
        try {
          const raw = sessionStorage.getItem('recall_pending_game_urls');

          if (raw) {
            const urls = JSON.parse(raw) as string[];
            void useReviewed.getState().markReviewed(urls);
            sessionStorage.removeItem('recall_pending_game_urls');
          }
        } catch {
          // Non-critical — reviewed tracking best-effort only.
        }

        // If we're still on the loading screen, no blunders were found — show the no-blunders modal.
        // If we're on the trainer screen, the user just finished the last blunder — show the done modal.
        if (screen === 'loading') {
          set({ sessionDone: true, sessionDoneReason: 'no_blunders', sessionId: undefined, screen: 'trainer' });
        } else {
          set({ sessionDone: true, sessionDoneReason: 'finished', sessionId: undefined });
        }
        return;
      }

      set({ currentBlunder: blunder, screen: 'trainer' });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load blunder.';

      if (screen === 'loading') {
        set({ error: msg, screen: 'setup' });
      } else {
        set({ error: msg });
      }
    }
  },

  submitAttempt: async (uciMove: string) => {
    const { sessionId, currentBlunder } = get();

    if (!sessionId || !currentBlunder) {
      return;
    }

    try {
      await apiSubmitAttempt({ session_id: sessionId, uci_move: uciMove });
      set({ reviewedCount: get().reviewedCount + 1 });
      await get().fetchBlunder();
    } catch (err) {
      if (err instanceof ApiError) {
        set({ error: err.message });
      } else {
        set({ error: 'Failed to submit attempt.' });
      }
    }
  },

  skipBlunder: async () => {
    const { sessionId } = get();

    if (!sessionId) {
      return;
    }

    try {
      await apiSkipBlunder(sessionId);
      await get().fetchBlunder();
    } catch (err) {
      if (err instanceof ApiError) {
        set({ error: err.message });
      } else {
        set({ error: 'Failed to skip blunder.' });
      }
    }
  },

  loadFavoritePosition: (opts) => {
    set({
      currentBlunder: {
        fen_before: opts.fen,
        color: opts.color,
        move_san: opts.moveSan,
        cp_loss: opts.cpLoss,
        classification: opts.classification,
        move_number: opts.moveNumber,
        prev_fen: null,
        prev_move_uci: null,
        best_moves: [],
        uci_played: '',
        eval_before_white_pov: 0,
      },
      screen: 'trainer',
      sessionId: undefined,
      blunderCount: 1,
      reviewedCount: 0,
    });
  },

  clearError: () => {
    set({ error: undefined });
  },

  reset: () => {
    set({
      sessionId: undefined,
      currentBlunder: undefined,
      screen: 'setup',
      loadingPct: 0,
      loadingStatus: '',
      loadingTitle: 'Analysing your games…',
      error: undefined,
      blunderCount: 0,
      reviewedCount: 0,
      sessionDone: false,
      sessionDoneReason: undefined,
    });
  },
}));

export default useSession;
