/** Scrollable game history table — shows all games immediately; enriches uncached ones behind a progress banner. */

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { analyzeGameHistory, fetchGameHistory } from '../../api/client';
import type { GameAnalysisResult, GameHistoryEntry } from '../../api/client';
import useReviewed from '../../hooks/useReviewed';
import { TimeClassIcon } from '../TimeClassIcons';
import './GameHistory.css';

// Games fetched per page.
const FETCH_SIZE = 5;

interface GameHistoryProps {
  username: string;
  timeClass: string;
  threshold: number;
  isGuest: boolean;
  onTrainGame: (url: string) => void;
  onGamesLoaded?: (games: GameHistoryEntry[]) => void;
  onTodayBlundersUpdate?: (count: number) => void;
  onAnalyzingChange?: (isAnalyzing: boolean) => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ── Batch analysis helpers ─────────────────────────────────────────────────

async function runBatchAnalysis(
  uncached: GameHistoryEntry[],
  username: string,
  threshold: number,
  isGuest: boolean,
  signal: { cancelled: boolean },
  onGameAnalyzed: (url: string, result: GameAnalysisResult) => void,
  onProgress: (current: number, total: number) => void,
): Promise<void> {
  for (let i = 0; i < uncached.length; i++) {
    if (signal.cancelled) {
      break;
    }

    const game = uncached[i];

    try {
      const result: GameAnalysisResult = await analyzeGameHistory(game.url, username, threshold, isGuest);

      if (!signal.cancelled) {
        onGameAnalyzed(game.url, result);
      }
    } catch {
      // Game stays visible with null blunder_count.
    }

    if (!signal.cancelled) {
      onProgress(i + 1, uncached.length);
    }
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────

function AnalysisProgressBanner({ current, total }: { current: number; total: number }): JSX.Element {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="history__analysis-banner">
      <span className="history__analysis-banner-label">
        Analysing game {current} / {total}…
      </span>
      <div className="history__analysis-banner-track">
        <div className="history__analysis-banner-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function GameRow({
  game,
  username,
  isReviewed,
  onTrain,
}: {
  game: GameHistoryEntry;
  username: string;
  isReviewed: boolean;
  onTrain: () => void;
}): JSX.Element {
  const isWhite = game.white_username.toLowerCase() === username.toLowerCase();

  const resultClass = game.result === 'win' ? 'win' : game.result === 'lose' ? 'lose' : 'draw';
  const resultLabel = game.result === 'win' ? 'Win' : game.result === 'lose' ? 'Loss' : 'Draw';

  return (
    <div className="history__row">
      {/* Time class icon */}
      <div className="history__col history__col--tc">
        <TimeClassIcon tc={game.time_class} size={16} />
      </div>

      {/* Players — 2 lines: white on top, black on bottom */}
      <div className="history__col history__col--players">
        <div className={`history__player-line${isWhite ? ' history__player-line--me' : ''}`}>
          <span className="history__piece history__piece--white" />
          <span className="history__player-name">{game.white_username}</span>
        </div>
        <div className={`history__player-line${!isWhite ? ' history__player-line--me' : ''}`}>
          <span className="history__piece history__piece--black" />
          <span className="history__player-name">{game.black_username}</span>
        </div>
      </div>

      {/* Result */}
      <div className="history__col history__col--result">
        <span className={`history__result history__result--${resultClass}`}>
          {resultLabel}
        </span>
      </div>

      {/* Accuracy — stacked per player */}
      <div className="history__col history__col--acc">
        <div className="history__acc-stack">
          <span className={`history__acc-val${isWhite ? ' history__acc-val--me' : ''}`}>
            {game.white_accuracy !== null && game.white_accuracy !== undefined ? `${game.white_accuracy.toFixed(1)}%` : '—'}
          </span>
          <span className={`history__acc-val${!isWhite ? ' history__acc-val--me' : ''}`}>
            {game.black_accuracy !== null && game.black_accuracy !== undefined ? `${game.black_accuracy.toFixed(1)}%` : '—'}
          </span>
        </div>
      </div>

      {/* Date */}
      <div className="history__col history__col--date">
        <span className="history__date">{formatDate(game.date)}</span>
      </div>

      {/* Review button */}
      <div className="history__col history__col--action">
        <button
          className={`history__review-btn${isReviewed ? ' history__review-btn--done' : ''}`}
          type="button"
          onClick={onTrain}
        >
          {isReviewed ? 'Re-review' : 'Review'}
        </button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

function GameHistory({
  username,
  timeClass,
  threshold,
  isGuest,
  onTrainGame,
  onGamesLoaded,
  onTodayBlundersUpdate,
  onAnalyzingChange,
}: GameHistoryProps): JSX.Element {
  const isReviewedFn = useReviewed((s) => s.isReviewed);

  const [displayedGames, setDisplayedGames] = useState<GameHistoryEntry[]>([]);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [isAnalyzingBatch, setIsAnalyzingBatch] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

  const onGamesLoadedRef = useRef(onGamesLoaded);
  onGamesLoadedRef.current = onGamesLoaded;
  const onTodayBlundersUpdateRef = useRef(onTodayBlundersUpdate);
  onTodayBlundersUpdateRef.current = onTodayBlundersUpdate;
  const onAnalyzingChangeRef = useRef(onAnalyzingChange);
  onAnalyzingChangeRef.current = onAnalyzingChange;

  useEffect(() => {
    onAnalyzingChangeRef.current?.(isAnalyzingBatch);
  }, [isAnalyzingBatch]);

  useEffect(() => {
    onGamesLoadedRef.current?.(displayedGames);

    const today = new Date().toDateString();
    const todayTotal = displayedGames
      .filter((g) => new Date(g.date).toDateString() === today && g.blunder_count !== null)
      .reduce((sum, g) => sum + (g.blunder_count ?? 0), 0);

    onTodayBlundersUpdateRef.current?.(todayTotal);
  }, [displayedGames]);

  async function startAnalysis(games: GameHistoryEntry[], signal: { cancelled: boolean }): Promise<void> {
    const uncached = games.filter((g) => g.blunder_count === null);

    if (uncached.length === 0) {
      return;
    }

    setIsAnalyzingBatch(true);
    setBatchProgress({ current: 0, total: uncached.length });

    try {
      await runBatchAnalysis(
        uncached,
        username,
        threshold,
        isGuest,
        signal,
        (url: string, result: GameAnalysisResult) => {
          setDisplayedGames((prev) =>
            prev.map((g) =>
              g.url === url
                ? { ...g, blunder_count: result.blunder_count, first_blunder_fen: result.first_blunder_fen, first_blunder_color: result.first_blunder_color }
                : g,
            ),
          );
        },
        (current: number, total: number) => setBatchProgress({ current, total }),
      );
    } finally {
      if (!signal.cancelled) {
        setIsAnalyzingBatch(false);
      }
    }
  }

  useEffect(() => {
    const signal = { cancelled: false };

    setDisplayedGames([]);
    setError('');
    setIsAnalyzingBatch(false);
    setInitialLoading(true);
    setHasMore(true);

    async function load(): Promise<void> {
      try {
        const games = await fetchGameHistory(username, timeClass, FETCH_SIZE, 0, threshold, isGuest);

        if (signal.cancelled) {
          return;
        }

        setDisplayedGames(games);
        setHasMore(games.length === FETCH_SIZE);
        setInitialLoading(false);

        await startAnalysis(games, signal);
      } catch (err: unknown) {
        if (!signal.cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to load games.';
          setError(msg);
          setInitialLoading(false);
        }
      }
    }

    load();

    return () => {
      signal.cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, timeClass, threshold, isGuest]);

  async function handleLoadMore(): Promise<void> {
    if (isAnalyzingBatch || loadingMore) {
      return;
    }

    const offset = displayedGames.length;
    setLoadingMore(true);

    const signal = { cancelled: false };

    try {
      const more = await fetchGameHistory(username, timeClass, FETCH_SIZE, offset, threshold, isGuest);

      setDisplayedGames((prev) => [...prev, ...more]);
      setHasMore(more.length === FETCH_SIZE);
      setLoadingMore(false);

      await startAnalysis(more, signal);
    } catch {
      setLoadingMore(false);
    }
  }

  if (initialLoading) {
    return (
      <div className="history">
        <div className="history__loading">
          <div className="history__spinner" />
          Loading games…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="history">
        <p className="history__error">{error}</p>
      </div>
    );
  }

  return (
    <div className="history">
      {isAnalyzingBatch && (
        <AnalysisProgressBanner current={batchProgress.current} total={batchProgress.total} />
      )}

      {displayedGames.length === 0 && !isAnalyzingBatch && (
        <p className="history__empty">No games found.</p>
      )}

      {displayedGames.length > 0 && (
        <div className="history__table">
          {/* Header */}
          <div className="history__header">
            <div className="history__col history__col--tc" />
            <div className="history__col history__col--players">Players</div>
            <div className="history__col history__col--result">Result</div>
            <div className="history__col history__col--acc">Accuracy</div>
            <div className="history__col history__col--date">Date</div>
            <div className="history__col history__col--action" />
          </div>

          {/* Scrollable body — load more is the last row */}
          <div className="history__body">
            {displayedGames.map((game, idx) => (
              <GameRow
                key={`game-${game.url}-${idx}`}
                game={game}
                username={username}
                isReviewed={isReviewedFn(game.url)}
                onTrain={() => onTrainGame(game.url)}
              />
            ))}

            {hasMore && (
              <div className="history__row history__row--load-more">
                <button
                  className="history__load-more"
                  type="button"
                  onClick={handleLoadMore}
                  disabled={isAnalyzingBatch || loadingMore}
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default GameHistory;
export type { GameHistoryEntry };
