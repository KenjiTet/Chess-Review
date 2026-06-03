/** Scrollable game history table — shows all games; blunder counts are populated on demand (per-game review). */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { fetchGameHistory } from '../../api/client';
import type { GameHistoryEntry } from '../../api/client';
import useReviewed from '../../hooks/useReviewed';
import { TimeClassIcon } from '../TimeClassIcons';
import './GameHistory.css';

// Games fetched per page.
const FETCH_SIZE = 10;

interface GameHistoryProps {
  username: string;
  timeClass: string;
  isGuest: boolean;
  platform: string;
  onTrainGame: (url: string) => void;
  onGamesLoaded?: (games: GameHistoryEntry[]) => void;
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

// ── Sub-components ─────────────────────────────────────────────────────────

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
        {game.blunder_count === 0 ? (
          <span className="history__no-blunders">No blunders</span>
        ) : (
          <button
            className={`history__review-btn${isReviewed ? ' history__review-btn--done' : ''}`}
            type="button"
            onClick={onTrain}
          >
            {isReviewed ? 'Re-review' : 'Review'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

function GameHistory({
  username,
  timeClass,
  isGuest,
  platform,
  onTrainGame,
  onGamesLoaded,
}: GameHistoryProps): JSX.Element {
  const isReviewedFn = useReviewed((s) => s.isReviewed);

  const [displayedGames, setDisplayedGames] = useState<GameHistoryEntry[]>([]);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const onGamesLoadedRef = useRef(onGamesLoaded);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef<boolean>(false);
  // Mirrors displayedGames.length so the observer callback can read it without a setState side-effect
  const gamesLengthRef = useRef<number>(0);

  useLayoutEffect(() => {
    onGamesLoadedRef.current = onGamesLoaded;
  });

  useEffect(() => {
    gamesLengthRef.current = displayedGames.length;
    onGamesLoadedRef.current?.(displayedGames);
  }, [displayedGames]);

  useEffect(() => {
    const signal = { cancelled: false };

    async function load(): Promise<void> {
      setDisplayedGames([]);
      setError('');
      setInitialLoading(true);
      setHasMore(true);

      try {
        const games = await fetchGameHistory(username, timeClass, FETCH_SIZE, 0, 300, isGuest, platform);

        if (signal.cancelled) {
          return;
        }

        setDisplayedGames(games);
        setHasMore(games.length === FETCH_SIZE);
        setInitialLoading(false);
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
  }, [username, timeClass, isGuest, platform]);

  const handleLoadMore = useCallback(async (currentLength: number): Promise<void> => {
    if (loadingMoreRef.current) {
      return;
    }

    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      const more = await fetchGameHistory(username, timeClass, FETCH_SIZE, currentLength, 300, isGuest, platform);
      setDisplayedGames((prev) => [...prev, ...more]);
      setHasMore(more.length === FETCH_SIZE);
    } catch {
      // Silent — sentinel will retry on next intersection
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [username, timeClass, isGuest, platform]);

  // IntersectionObserver: load more when the sentinel scrolls into view inside the body container
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const body = bodyRef.current;

    if (!sentinel || !body) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        if (entry?.isIntersecting && !loadingMoreRef.current) {
          void handleLoadMore(gamesLengthRef.current);
        }
      },
      { root: body, threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleLoadMore, initialLoading]);

  if (initialLoading) {
    return (
      <div className="history">
        <div className="history__table">
          <div className="history__header">
            <div className="history__col history__col--tc" />
            <div className="history__col history__col--players">Players</div>
            <div className="history__col history__col--result">Result</div>
            <div className="history__col history__col--acc">Accuracy</div>
            <div className="history__col history__col--date">Date</div>
            <div className="history__col history__col--action" />
          </div>
          <div className="history__body">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={`skeleton-row-${i}`} className="history__row history__row--skeleton">
                <div className="history__col history__col--tc">
                  <div className="skeleton skeleton--icon" />
                </div>
                <div className="history__col history__col--players">
                  <div className="skeleton skeleton--md" />
                  <div className="skeleton skeleton--sm" />
                </div>
                <div className="history__col history__col--result">
                  <div className="skeleton skeleton--xs" />
                </div>
                <div className="history__col history__col--acc">
                  <div className="skeleton skeleton--xs" />
                </div>
                <div className="history__col history__col--date">
                  <div className="skeleton skeleton--sm" />
                </div>
                <div className="history__col history__col--action">
                  <div className="skeleton skeleton--btn" />
                </div>
              </div>
            ))}
          </div>
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
      {displayedGames.length === 0 && (
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

          {/* Scrollable body — sentinel at bottom triggers infinite scroll */}
          <div ref={bodyRef} className="history__body">
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
              <div ref={sentinelRef} className="history__sentinel">
                {loadingMore && <div className="history__spinner history__spinner--inline" />}
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
