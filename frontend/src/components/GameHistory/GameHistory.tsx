/** Scrollable game history table — shows all games with blunder counts and review status. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { fetchGameHistory, fetchGameAnalysis, fetchUserAnalysisStatus } from '../../api/client';
import type { GameHistoryEntry } from '../../api/client';
import useReviewed from '../../hooks/useReviewed';
import { TimeClassIcon } from '../TimeClassIcons';
import BlunderCountModal from '../BlunderCountModal/BlunderCountModal';
import { ALL_CATEGORY_KEYS, UNCATEGORIZED_CATEGORY } from '../../constants/blunderCategories';
import './GameHistory.css';
import './GameHistory.mobile.css';

// Games fetched per page.
const FETCH_SIZE = 25;

// How often to poll the background queue for live analysis status (ms).
const STATUS_POLL_MS = 3000;

interface GameHistoryProps {
  username: string;
  timeClass: string;
  isGuest: boolean;
  platform: string;
  /** Blunder threshold in centipawns — used when fetching history and when triggering analysis. */
  threshold: number;
  isMobile?: boolean;
  /** Selected blunder-category keys; a game shows only if it has a blunder of a selected type. */
  selectedCategories?: Set<string>;
  /** Whether games with zero blunders are shown. */
  showCleanGames?: boolean;
  /** Whether games the user has already reviewed are shown. */
  showReviewedGames?: boolean;
  /** Whether games that have been analysed are shown. */
  showAnalysedGames?: boolean;
  onTrainGame: (url: string) => void;
  onGamesLoaded?: (games: GameHistoryEntry[]) => void;
  /** Fired after a game finishes analysing so the menu can refresh DB-derived stats. */
  onAnalysisComplete?: () => void;
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

function formatDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
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

function BlunderCell({ blunderCount, onShowBreakdown }: { blunderCount: number | null; onShowBreakdown: () => void }): JSX.Element {
  if (blunderCount === null) {
    return <span className="history__dash">—</span>;
  }

  if (blunderCount === 0) {
    return <span className="history__blunders history__blunders--low">0</span>;
  }

  const cls = blunderCount >= 4 ? 'high' : blunderCount >= 2 ? 'mid' : 'low';

  // Clickable: opens the per-category breakdown modal for this game.
  return (
    <button
      type="button"
      className={`history__blunders history__blunders--${cls} history__blunders--clickable`}
      onClick={onShowBreakdown}
      title="Show blunder breakdown"
    >
      <AlertTriangleSvg />
      {blunderCount}
    </button>
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
    return (
      <span className="history__clean">
        <CheckCircleSvg />
        Clean
      </span>
    );
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
  onShowBreakdown,
}: {
  game: GameHistoryEntry;
  username: string;
  isReviewed: boolean;
  isAnalysing: boolean;
  onTrain: () => void;
  onAnalyse: () => void;
  onShowBreakdown: () => void;
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
        <BlunderCell blunderCount={game.blunder_count} onShowBreakdown={onShowBreakdown} />
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
  isAnalysing,
  onTrain,
  onAnalyse,
  onShowBreakdown,
}: {
  game: GameHistoryEntry;
  username: string;
  isReviewed: boolean;
  isAnalysing: boolean;
  onTrain: () => void;
  onAnalyse: () => void;
  onShowBreakdown: () => void;
}): JSX.Element {
  const isWhite = game.white_username.toLowerCase() === username.toLowerCase();

  const isTappable = game.blunder_count !== null && game.blunder_count > 0;

  const resultClass = game.result === 'win' ? 'win' : game.result === 'lose' ? 'lose' : 'draw';
  const resultLabel = game.result === 'win' ? 'Win' : game.result === 'lose' ? 'Loss' : 'Draw';

  const blunderCount = game.blunder_count;
  const blunderCls = blunderCount !== null && blunderCount >= 4
    ? 'high'
    : blunderCount !== null && blunderCount >= 2
      ? 'mid'
      : 'low';

  function handleClick(): void {
    if (!isTappable) {
      return;
    }
    onTrain();
  }

  function formatAcc(val: number | null | undefined): string {
    if (val !== null && val !== undefined) {
      return `${val.toFixed(1)}%`;
    }
    return '—';
  }

  function renderAccCol(): JSX.Element {
    return (
      <div className="game-card__acc-col">
        <span className={`game-card__acc-val${isWhite ? ' game-card__acc-val--me' : ''}`}>
          {formatAcc(game.white_accuracy)}
        </span>
        <span className={`game-card__acc-val${!isWhite ? ' game-card__acc-val--me' : ''}`}>
          {formatAcc(game.black_accuracy)}
        </span>
      </div>
    );
  }

  function renderBlunderCol(): JSX.Element {
    if (isAnalysing) {
      return (
        <div className="game-card__blunder-col">
          <span className="game-card__spin" />
        </div>
      );
    }

    if (blunderCount === null) {
      return (
        <div className="game-card__blunder-col">
          <span className="game-card__istat game-card__istat--muted">-</span>
        </div>
      );
    }

    if (blunderCount === 0) {
      return (
        <div className="game-card__blunder-col">
          <span className="game-card__istat game-card__istat--clean">0</span>
        </div>
      );
    }

    return (
      <div className="game-card__blunder-col">
        <button
          type="button"
          className={`game-card__istat game-card__istat--blunders game-card__istat--${blunderCls} game-card__istat--clickable`}
          onClick={(e) => {
            e.stopPropagation();
            onShowBreakdown();
          }}
          title="Show blunder breakdown"
        >
          <AlertTriangleSvg />
          {blunderCount}
        </button>
      </div>
    );
  }

  function renderAction(): JSX.Element {
    if (isAnalysing) {
      return <span className="game-card__btn game-card__btn--analysing">Engine</span>;
    }

    if (blunderCount === null) {
      return (
        <button
          className="game-card__btn game-card__btn--analyse"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAnalyse();
          }}
        >
          <MagnifierSvg />
          Analyse
        </button>
      );
    }

    if (blunderCount === 0) {
      return <span className="game-card__clean"><CheckCircleSvg />Clean</span>;
    }

    if (isReviewed) {
      return (
        <button
          className="game-card__btn game-card__btn--rereview"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTrain();
          }}
        >
          Re-review
        </button>
      );
    }

    return (
      <button
        className="game-card__btn game-card__btn--review"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTrain();
        }}
      >
        Review
      </button>
    );
  }

  return (
    <div
      className={`game-card${isTappable ? ' game-card--tappable' : ''}${isReviewed && blunderCount !== null && blunderCount > 0 ? ' game-card--reviewed' : ''}`}
      onClick={handleClick}
      role={isTappable ? 'button' : undefined}
      tabIndex={isTappable ? 0 : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleClick();
        }
      }}
    >
      <div className="game-card__tc-col">
        <span className="game-card__date">{formatDateShort(game.date)}</span>
        <div className="game-card__tc">
          <TimeClassIcon tc={game.time_class} size={16} />
        </div>
      </div>

      <div className="game-card__players">
        <div className="game-card__player-line">
          <span className="game-card__piece game-card__piece--white" />
          <span className={`game-card__player-name${isWhite ? ' game-card__player-name--me' : ''}`}>
            {game.white_username}
            {game.white_rating !== null && game.white_rating !== undefined && (
              <span className="game-card__elo"> ({game.white_rating})</span>
            )}
          </span>
        </div>
        <div className="game-card__player-line">
          <span className="game-card__piece game-card__piece--black" />
          <span className={`game-card__player-name${!isWhite ? ' game-card__player-name--me' : ''}`}>
            {game.black_username}
            {game.black_rating !== null && game.black_rating !== undefined && (
              <span className="game-card__elo"> ({game.black_rating})</span>
            )}
          </span>
        </div>
      </div>

      {renderAccCol()}
      {renderBlunderCol()}

      <div className="game-card__right-col">
        <span className={`game-card__result game-card__result--${resultClass}`}>
          {resultLabel}
        </span>
        {renderAction()}
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
  selectedCategories,
  showCleanGames = true,
  showReviewedGames = true,
  showAnalysedGames = true,
  onTrainGame,
  onGamesLoaded,
  onAnalysisComplete,
}: GameHistoryProps): JSX.Element {
  const isReviewedFn = useReviewed((s) => s.isReviewed);

  const [displayedGames, setDisplayedGames] = useState<GameHistoryEntry[]>([]);
  /** Game whose blunder breakdown modal is open, if any. */
  const [breakdownGame, setBreakdownGame] = useState<GameHistoryEntry | undefined>(undefined);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  /** Tracks which game URLs are currently being analysed (shows spinner). */
  const [analysingUrls, setAnalysingUrls] = useState<Set<string>>(new Set());

  const onGamesLoadedRef = useRef(onGamesLoaded);
  const onAnalysisCompleteRef = useRef(onAnalysisComplete);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef<boolean>(false);
  const gamesLengthRef = useRef<number>(0);
  /** URLs the background queue reported as queued/analysing on the previous poll. */
  const queuedUrlsRef = useRef<Set<string>>(new Set());
  /** URLs currently shown in the list — guards completion refreshes to visible games. */
  const displayedUrlsRef = useRef<Set<string>>(new Set());
  /** URLs already sent for category backfill, so each is attempted at most once. */
  const categoryBackfillRef = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    onGamesLoadedRef.current = onGamesLoaded;
    onAnalysisCompleteRef.current = onAnalysisComplete;
  });

  useEffect(() => {
    gamesLengthRef.current = displayedGames.length;
    displayedUrlsRef.current = new Set(displayedGames.map((g) => g.url));
    onGamesLoadedRef.current?.(displayedGames);
  }, [displayedGames]);

  // Quietly backfill real categories for games cached before they were computed.
  // Such games surface an "uncategorized" bucket; re-running analysis (cache hit +
  // engine only for the missing blunders) fills them, then the row is updated.
  useEffect(() => {
    if (isGuest) {
      return undefined;
    }

    let cancelled = false;

    async function backfill(): Promise<void> {
      for (const game of displayedGames) {
        if (cancelled) {
          return;
        }

        const needsBackfill = (game.blunder_count ?? 0) > 0
          && (game.blunder_categories?.[UNCATEGORIZED_CATEGORY.key] ?? 0) > 0
          && !categoryBackfillRef.current.has(game.url);

        if (!needsBackfill) {
          continue;
        }

        // Mark first so a re-render mid-flight never double-submits the same game.
        categoryBackfillRef.current.add(game.url);

        try {
          const result = await fetchGameAnalysis(game.url, username, threshold, false, platform);

          if (cancelled) {
            return;
          }

          setDisplayedGames((prev) =>
            prev.map((g) => {
              if (g.url !== game.url) {
                return g;
              }
              return { ...g, blunder_categories: result.blunder_categories, blunder_count: result.blunder_count };
            }),
          );
        } catch {
          // Leave the game as-is; it keeps the eval-only fallback breakdown.
        }
      }
    }

    void backfill();

    return () => {
      cancelled = true;
    };
  }, [displayedGames, isGuest, username, threshold, platform]);

  useEffect(() => {
    const signal = { cancelled: false };

    async function load(): Promise<void> {
      setDisplayedGames([]);
      setError('');
      setInitialLoading(true);
      setHasMore(true);
      // New query scope (threshold/handle/time class) — allow backfill to re-run.
      categoryBackfillRef.current = new Set();

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
          return {
            ...g,
            blunder_count: result.blunder_count,
            white_accuracy: result.white_accuracy,
            black_accuracy: result.black_accuracy,
            blunder_categories: result.blunder_categories,
          };
        }),
      );

      // Let the menu refresh DB-derived stats (avg blunders, blunders drilled).
      onAnalysisCompleteRef.current?.();
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

  // Pull a fresh blunder count for a single game once the queue finished it.
  const refreshAnalysed = useCallback(async (gameUrl: string): Promise<void> => {
    try {
      const result = await fetchGameAnalysis(gameUrl, username, threshold, isGuest, platform);

      setDisplayedGames((prev) =>
        prev.map((g) => {
          if (g.url !== gameUrl) {
            return g;
          }
          return {
            ...g,
            blunder_count: result.blunder_count,
            white_accuracy: result.white_accuracy,
            black_accuracy: result.black_accuracy,
            blunder_categories: result.blunder_categories,
          };
        }),
      );

      // Let the menu refresh DB-derived stats (avg blunders, blunders drilled).
      onAnalysisCompleteRef.current?.();
    } catch {
      // Leave the game as-is; a manual analyse still works.
    } finally {
      // Clear the spinner only now, so the row goes straight to its result.
      setAnalysingUrls((prev) => {
        const next = new Set(prev);
        next.delete(gameUrl);
        return next;
      });
    }
  }, [username, threshold, isGuest, platform]);

  // Poll the background queue so spinners appear live on games it is analysing,
  // and so a game's blunder count refreshes the moment the queue finishes it.
  useEffect(() => {
    if (isGuest) {
      return undefined;
    }

    let cancelled = false;
    queuedUrlsRef.current = new Set();

    async function poll(): Promise<void> {
      try {
        const status = await fetchUserAnalysisStatus();

        if (cancelled) {
          return;
        }

        // Treat queued + analysing alike: both warrant a live spinner.
        const active = new Set<string>([...status.analysing, ...status.pending]);

        // Games that left the queue since the last poll have finished analysing.
        const finished: string[] = [];
        queuedUrlsRef.current.forEach((url) => {
          if (!active.has(url) && displayedUrlsRef.current.has(url)) {
            finished.push(url);
          }
        });

        queuedUrlsRef.current = active;

        setAnalysingUrls((prev) => {
          const next = new Set(prev);
          active.forEach((url) => next.add(url));
          return next;
        });

        // refreshAnalysed updates the count and clears each spinner when done.
        finished.forEach((url) => void refreshAnalysed(url));
      } catch {
        // Ignore poll failures; the next tick retries.
      }
    }

    void poll();
    const intervalId = window.setInterval(() => void poll(), STATUS_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isGuest, username, platform, timeClass, threshold, refreshAnalysed]);

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

  // Client-side filter over the already-fetched list. Each toggle removes its
  // subset; a game must pass every active toggle to remain visible.
  function matchesFilter(game: GameHistoryEntry): boolean {
    const isAnalysed = game.blunder_count !== null;

    // Hide analysed games when that toggle is off (leaves only un-analysed ones).
    if (isAnalysed && !showAnalysedGames) {
      return false;
    }

    // Hide games the user already reviewed when that toggle is off.
    if (!showReviewedGames && isReviewedFn(game.url)) {
      return false;
    }

    // Un-analysed games stay visible so their Analyse action remains reachable.
    if (game.blunder_count === null) {
      return true;
    }

    // Zero-blunder games are governed by the show-clean toggle.
    if (game.blunder_count === 0) {
      return showCleanGames;
    }

    // No category selection given (filter not in use) — show everything.
    if (selectedCategories === undefined) {
      return true;
    }

    // Every selectable type chosen (default) — show all blunder games, including
    // positional/uncategorized ones that aren't represented by a filter pill.
    if (ALL_CATEGORY_KEYS.every((key) => selectedCategories.has(key))) {
      return true;
    }

    const categoryKeys = Object.keys(game.blunder_categories ?? {});

    // Legacy game with blunders but no stored breakdown: show while any filter is active.
    if (categoryKeys.length === 0) {
      return selectedCategories.size > 0;
    }

    return categoryKeys.some((key) => selectedCategories.has(key));
  }

  const visibleGames = displayedGames.filter(matchesFilter);

  const mobileHeader = (
    <div className="history__mobile-header">
      <div className="history__mob-col history__mob-col--tc" />
      <div className="history__mob-col history__mob-col--players">Player</div>
      <div className="history__mob-col history__mob-col--acc">Acc</div>
      <div className="history__mob-col history__mob-col--blunders">Blunders</div>
      <div className="history__mob-col history__mob-col--result">Result</div>
    </div>
  );

  if (initialLoading) {
    if (isMobile) {
      return (
        <div className="history history--mobile">
          {mobileHeader}
          <div className="history__cards-skeleton">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={`mob-skeleton-${i}`} className="game-card game-card--skeleton">
                <div className="game-card__tc" />
                <div className="game-card__players">
                  <div className="skeleton-line skeleton-line--md" />
                  <div className="skeleton-line skeleton-line--sm" style={{ marginTop: 4 }} />
                </div>
                <div className="game-card__inline-stats">
                  <div className="skeleton-line skeleton-line--acc" />
                  <div className="skeleton-line skeleton-line--acc" style={{ marginTop: 2 }} />
                </div>
                <div className="game-card__right-col">
                  <div className="skeleton-line skeleton-line--sm" />
                  <div className="skeleton-line skeleton-line--acc" style={{ marginTop: 2 }} />
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
        {mobileHeader}

        {visibleGames.length === 0 && (
          <p className="history__empty">No games found.</p>
        )}

        {visibleGames.length > 0 && (
          <div ref={bodyRef} className="history__body">
            {visibleGames.map((game, idx) => (
              <GameCard
                key={`mob-game-${game.url}-${idx}`}
                game={game}
                username={username}
                isReviewed={isReviewedFn(game.url)}
                isAnalysing={analysingUrls.has(game.url)}
                onTrain={() => onTrainGame(game.url)}
                onAnalyse={() => void handleAnalyse(game.url)}
                onShowBreakdown={() => setBreakdownGame(game)}
              />
            ))}

            {hasMore && (
              <div ref={sentinelRef} className="history__sentinel">
                {loadingMore && <div className="history__spinner history__spinner--inline" />}
              </div>
            )}
          </div>
        )}

        <BlunderCountModal
          isOpen={breakdownGame !== undefined}
          total={breakdownGame?.blunder_count ?? 0}
          categories={breakdownGame?.blunder_categories ?? {}}
          selectedCategories={selectedCategories}
          onClose={() => setBreakdownGame(undefined)}
        />
      </div>
    );
  }

  // Desktop table layout
  return (
    <div className="history">
      {visibleGames.length === 0 && (
        <p className="history__empty">No games found.</p>
      )}

      {visibleGames.length > 0 && (
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
            {visibleGames.map((game, idx) => (
              <GameRow
                key={`game-${game.url}-${idx}`}
                game={game}
                username={username}
                isReviewed={isReviewedFn(game.url)}
                isAnalysing={analysingUrls.has(game.url)}
                onTrain={() => onTrainGame(game.url)}
                onAnalyse={() => void handleAnalyse(game.url)}
                onShowBreakdown={() => setBreakdownGame(game)}
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

      <BlunderCountModal
        isOpen={breakdownGame !== undefined}
        total={breakdownGame?.blunder_count ?? 0}
        categories={breakdownGame?.blunder_categories ?? {}}
        onClose={() => setBreakdownGame(undefined)}
      />
    </div>
  );
}

export default GameHistory;
export type { GameHistoryEntry };
