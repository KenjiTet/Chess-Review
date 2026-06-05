/** Scrollable game history table — shows all games with blunder counts and review status. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { fetchGameHistory, fetchGameAnalysis } from '../../api/client';
import type { GameHistoryEntry } from '../../api/client';
import useReviewed from '../../hooks/useReviewed';
import { TimeClassIcon } from '../TimeClassIcons';
import './GameHistory.css';
import './GameHistory.mobile.css';

// Games fetched per page.
const FETCH_SIZE = 10;

interface GameHistoryProps {
  username: string;
  timeClass: string;
  isGuest: boolean;
  platform: string;
  /** Blunder threshold in centipawns — used when fetching history and when triggering analysis. */
  threshold: number;
  isMobile?: boolean;
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

// ── Inline SVG icons ───────────────────────────────────────────────────────

function AlertTriangleSvg(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CheckCircleSvg(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function MagnifierSvg(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

// ── Blunder cell ───────────────────────────────────────────────────────────

function BlunderCell({ blunderCount }: { blunderCount: number | null }): JSX.Element {
  if (blunderCount === null) {
    return <span className="history__dash">—</span>;
  }

  if (blunderCount === 0) {
    return (
      <span className="history__clean">
        <CheckCircleSvg />
        Clean
      </span>
    );
  }

  const cls = blunderCount >= 4 ? 'high' : blunderCount >= 2 ? 'mid' : 'low';

  return (
    <span className={`history__blunders history__blunders--${cls}`}>
      <AlertTriangleSvg />
      {blunderCount}
    </span>
  );
}

// ── Action cell ────────────────────────────────────────────────────────────

function ActionCell({
  game,
  isAnalysing,
  isReviewed,
  onTrain,
  onAnalyse,
}: {
  game: GameHistoryEntry;
  isAnalysing: boolean;
  isReviewed: boolean;
  onTrain: () => void;
  onAnalyse: () => void;
}): JSX.Element {
  if (isAnalysing) {
    return (
      <span className="history__btn history__btn--analysing">
        <span className="history__spin" />
        Analysing…
      </span>
    );
  }

  if (game.blunder_count === null) {
    return (
      <button className="history__btn history__btn--analyse" type="button" onClick={onAnalyse}>
        <MagnifierSvg />
        Analyse
      </button>
    );
  }

  if (game.blunder_count === 0) {
    return <></>;
  }

  if (isReviewed) {
    return (
      <button className="history__btn history__btn--rereview" type="button" onClick={onTrain}>
        Re-review
      </button>
    );
  }

  return (
    <button className="history__btn history__btn--review" type="button" onClick={onTrain}>
      Review
    </button>
  );
}

// ── Desktop row ────────────────────────────────────────────────────────────

function GameRow({
  game,
  username,
  isReviewed,
  isAnalysing,
  onTrain,
  onAnalyse,
}: {
  game: GameHistoryEntry;
  username: string;
  isReviewed: boolean;
  isAnalysing: boolean;
  onTrain: () => void;
  onAnalyse: () => void;
}): JSX.Element {
  const isWhite = game.white_username.toLowerCase() === username.toLowerCase();

  const resultClass = game.result === 'win' ? 'win' : game.result === 'lose' ? 'lose' : 'draw';
  const resultLabel = game.result === 'win' ? 'Win' : game.result === 'lose' ? 'Loss' : 'Draw';

  return (
    <div className={`history__row${isReviewed && game.blunder_count !== null && game.blunder_count > 0 ? ' history__row--reviewed' : ''}`}>
      {/* Time class icon */}
      <div className="history__col history__col--tc">
        <TimeClassIcon tc={game.time_class} size={16} />
      </div>

      {/* Players — 2 lines: white on top, black on bottom */}
      <div className="history__col history__col--players">
        <div className={`history__player-line${isWhite ? ' history__player-line--me' : ''}`}>
          <span className="history__piece history__piece--white" />
          <span className="history__player-name">{game.white_username}</span>
          <span className="history__player-elo">({game.white_rating ?? ''})</span>
        </div>
        <div className={`history__player-line${!isWhite ? ' history__player-line--me' : ''}`}>
          <span className="history__piece history__piece--black" />
          <span className="history__player-name">{game.black_username}</span>
          <span className="history__player-elo">({game.black_rating ?? ''})</span>
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

      {/* Blunders */}
      <div className="history__col history__col--blunders">
        <BlunderCell blunderCount={game.blunder_count} />
      </div>

      {/* Date */}
      <div className="history__col history__col--date">
        <span className="history__date">{formatDate(game.date)}</span>
      </div>

      {/* Action */}
      <div className="history__col history__col--action">
        <ActionCell
          game={game}
          isAnalysing={isAnalysing}
          isReviewed={isReviewed}
          onTrain={onTrain}
          onAnalyse={onAnalyse}
        />
      </div>
    </div>
  );
}

// ── Mobile card component ──────────────────────────────────────────────────

function GameCard({
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
  const myAccuracy = isWhite ? game.white_accuracy : game.black_accuracy;

  const noBlunders = game.blunder_count === 0;

  function handleClick(): void {
    if (noBlunders) {
      return;
    }
    onTrain();
  }

  return (
    <div
      className={`game-card${noBlunders ? ' game-card--no-blunders' : ''}${isReviewed ? ' game-card--reviewed' : ''}`}
      onClick={handleClick}
      role={noBlunders ? undefined : 'button'}
      tabIndex={noBlunders ? undefined : 0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleClick();
        }
      }}
    >
      {/* Time class icon */}
      <div className="game-card__tc-icon">
        <TimeClassIcon tc={game.time_class} size={16} />
      </div>

      {/* Players */}
      <div className="game-card__main">
        <div className="game-card__player-line">
          <span className="game-card__piece game-card__piece--white" />
          <span className={`game-card__player-name${isWhite ? ' game-card__player-name--me' : ''}`}>
            {game.white_username}
          </span>
          {isReviewed && isWhite && (
            <span className="game-card__badge">Reviewed</span>
          )}
        </div>
        <div className="game-card__player-line">
          <span className="game-card__piece game-card__piece--black" />
          <span className={`game-card__player-name${!isWhite ? ' game-card__player-name--me' : ''}`}>
            {game.black_username}
          </span>
          {isReviewed && !isWhite && (
            <span className="game-card__badge">Reviewed</span>
          )}
        </div>
      </div>

      {/* Right: accuracy + date */}
      <div className="game-card__right">
        <div className="game-card__acc">
          {myAccuracy !== null && myAccuracy !== undefined ? `${myAccuracy.toFixed(1)}%` : '—'}
          <small>accuracy</small>
        </div>
        <div className="game-card__date">{formatDate(game.date)}</div>
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
  threshold,
  isMobile = false,
  onTrainGame,
  onGamesLoaded,
}: GameHistoryProps): JSX.Element {
  const isReviewedFn = useReviewed((s) => s.isReviewed);

  const [displayedGames, setDisplayedGames] = useState<GameHistoryEntry[]>([]);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  /** Tracks which game URLs are currently being analysed (shows spinner). */
  const [analysingUrls, setAnalysingUrls] = useState<Set<string>>(new Set());

  const onGamesLoadedRef = useRef(onGamesLoaded);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef<boolean>(false);
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
        const games = await fetchGameHistory(username, timeClass, FETCH_SIZE, 0, threshold, isGuest, platform);

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

    void load();

    return () => {
      signal.cancelled = true;
    };
  }, [username, timeClass, isGuest, platform, threshold]);

  const handleLoadMore = useCallback(async (currentLength: number): Promise<void> => {
    if (loadingMoreRef.current) {
      return;
    }

    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      const more = await fetchGameHistory(username, timeClass, FETCH_SIZE, currentLength, threshold, isGuest, platform);
      setDisplayedGames((prev) => [...prev, ...more]);
      setHasMore(more.length === FETCH_SIZE);
    } catch {
      // Silent — sentinel will retry on next intersection
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [username, timeClass, isGuest, platform, threshold]);

  async function handleAnalyse(gameUrl: string): Promise<void> {
    setAnalysingUrls((prev) => new Set([...prev, gameUrl]));

    try {
      const result = await fetchGameAnalysis(gameUrl, username, threshold, isGuest, platform);

      setDisplayedGames((prev) =>
        prev.map((g) => {
          if (g.url !== gameUrl) {
            return g;
          }
          return { ...g, blunder_count: result.blunder_count };
        }),
      );
    } catch {
      // Silently fail — the game stays in the un-analysed state.
    } finally {
      setAnalysingUrls((prev) => {
        const next = new Set(prev);
        next.delete(gameUrl);
        return next;
      });
    }
  }

  // IntersectionObserver: load more when the sentinel scrolls into view.
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
    if (isMobile) {
      return (
        <div className="history history--mobile">
          <div className="history__cards-skeleton">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={`mob-skeleton-${i}`} className="game-card game-card--skeleton">
                <div className="game-card__tc-icon" />
                <div className="game-card__main">
                  <div className="skeleton-line skeleton-line--md" />
                  <div className="skeleton-line skeleton-line--sm" style={{ marginTop: 5 }} />
                </div>
                <div className="game-card__right">
                  <div className="skeleton-line skeleton-line--acc" />
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="history">
        <div className="history__table">
          <div className="history__header">
            <div className="history__col history__col--tc" />
            <div className="history__col history__col--players">Players</div>
            <div className="history__col history__col--result">Result</div>
            <div className="history__col history__col--acc">Accuracy</div>
            <div className="history__col history__col--blunders">Blunders</div>
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
                <div className="history__col history__col--blunders">
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

  // Mobile card layout
  if (isMobile) {
    return (
      <div className="history history--mobile">
        {displayedGames.length === 0 && (
          <p className="history__empty">No games found.</p>
        )}

        {displayedGames.length > 0 && (
          <div ref={bodyRef} className="history__body">
            {displayedGames.map((game, idx) => (
              <GameCard
                key={`mob-game-${game.url}-${idx}`}
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
        )}
      </div>
    );
  }

  // Desktop table layout
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
            <div className="history__col history__col--blunders">Blunders</div>
            <div className="history__col history__col--date">Date</div>
            <div className="history__col history__col--action" />
          </div>

          {/* Scrollable body */}
          <div ref={bodyRef} className="history__body">
            {displayedGames.map((game, idx) => (
              <GameRow
                key={`game-${game.url}-${idx}`}
                game={game}
                username={username}
                isReviewed={isReviewedFn(game.url)}
                isAnalysing={analysingUrls.has(game.url)}
                onTrain={() => onTrainGame(game.url)}
                onAnalyse={() => void handleAnalyse(game.url)}
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
