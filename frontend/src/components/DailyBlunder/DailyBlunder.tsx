/**
 * Blunder of the Day screen.
 *
 * Presents a dedicated hub first — today's puzzle as an engaging hero card with
 * a call-to-action, the user's solve stats, and a history of previous days
 * (each flagged solved / unsolved). Selecting a puzzle opens the shared
 * TrainerBoard so it drills with the exact same tools as the training session.
 *
 * "Solved" is tracked client-side (useDailySolves): the first best move played
 * at a day's blunder position marks that day solved.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { getBlunderOfDayHistory } from '../../api/client';
import type { BlunderResponse, DailyBlunderHistoryItem } from '../../api/client';
import { DEFAULT_BLUNDER_CATEGORY, getBlunderCategory } from '../../constants/blunderCategories';
import useDailySolves from '../../hooks/useDailySolves';
import { generateBoardImage } from '../../utils/generateBoardImage';
import TrainerBoard from '../TrainerBoard/TrainerBoard';
import './DailyBlunder.css';

interface DailyBlunderProps {
  isMobile?: boolean;
}

// View model derived from a history item — precomputes the display strings and
// the (relatively expensive) board thumbnail so the list renders cheaply.
interface DailyView {
  day: string;
  blunder: BlunderResponse;
  orientation: 'white' | 'black';
  gmName: string;
  gmRating: number | undefined;
  categoryLabel: string;
  categoryStyle: { color: string; background: string; borderColor: string };
  explanation: string;
  thumb: string;
  dateLabel: string;
}

/** Name of the blundering side, falling back gracefully. */
function gmName(blunder: BlunderResponse): string {
  const isWhite = blunder.color === 'white';
  const username = isWhite ? blunder.white_username : blunder.black_username;

  if (username !== undefined && username !== '') {
    return username;
  }

  return 'the Grandmaster';
}

/** Format an ISO "YYYY-MM-DD" as a local, human date without timezone drift. */
function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map((part) => Number(part));

  if (!year || !month || !date) {
    return day;
  }

  const parsed = new Date(year, month - 1, date);
  // Force en-US so the date reads in English regardless of the user's locale.
  return parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Build the display view model for one day's puzzle. */
function toView(item: DailyBlunderHistoryItem): DailyView {
  const blunder = item.blunder;
  const isWhite = blunder.color === 'white';
  const orientation: 'white' | 'black' = isWhite ? 'white' : 'black';
  const rating = isWhite ? blunder.white_rating : blunder.black_rating;
  const category = getBlunderCategory(blunder.category) ?? DEFAULT_BLUNDER_CATEGORY;

  return {
    day: item.day,
    blunder,
    orientation,
    gmName: gmName(blunder),
    gmRating: rating !== undefined && rating > 0 ? rating : undefined,
    categoryLabel: category.label,
    categoryStyle: { color: category.color, background: category.bg, borderColor: category.border },
    explanation: category.shortPrompt,
    thumb: generateBoardImage(blunder.fen_before, orientation),
    dateLabel: formatDay(item.day),
  };
}

function DailyBlunder({ isMobile = false }: DailyBlunderProps): JSX.Element {
  const solvedDays = useDailySolves((s) => s.solvedDays);
  const markSolved = useDailySolves((s) => s.markSolved);

  const [history, setHistory] = useState<DailyBlunderHistoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | undefined>(undefined);
  // The day currently open in the board view — undefined means the hub is shown.
  const [activeDay, setActiveDay] = useState<string | undefined>(undefined);
  // Shows the victory modal after the active puzzle is solved.
  const [showVictory, setShowVictory] = useState<boolean>(false);
  // Pending timer that pops the victory modal a beat after the puzzle is solved,
  // so the winning move is visible on the board before the modal covers it.
  const victoryTimerRef = useRef<number | undefined>(undefined);

  // Cancel any pending victory timer (leaving a puzzle, resetting, or unmounting).
  function clearVictoryTimer(): void {
    if (victoryTimerRef.current !== undefined) {
      window.clearTimeout(victoryTimerRef.current);
      victoryTimerRef.current = undefined;
    }
  }

  // Clear the pending victory timer when the component unmounts.
  useEffect(() => {
    return () => {
      clearVictoryTimer();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      setError(undefined);

      try {
        const items = await getBlunderOfDayHistory(30);

        if (!cancelled) {
          setHistory(items);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to load the blunder of the day.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Precompute view models once per history load — avoids regenerating the board
  // thumbnails on every render (e.g. when the solved set changes).
  const views = useMemo(() => history.map(toView), [history]);

  const solvedSet = useMemo(() => new Set(solvedDays), [solvedDays]);

  if (loading) {
    return (
      <div className="daily">
        <div className="daily__status">Loading today's blunder…</div>
      </div>
    );
  }

  if (error !== undefined || views.length === 0) {
    return (
      <div className="daily">
        <div className="daily__status daily__status--error">
          {error ?? "Today's blunder isn't ready yet — check back in a little while."}
        </div>
      </div>
    );
  }

  const today = views[0];
  const past = views.slice(1);
  const activeView = activeDay !== undefined ? views.find((view) => view.day === activeDay) : undefined;

  // Open a puzzle in the board view, clearing any stale victory modal.
  function openPuzzle(day: string): void {
    clearVictoryTimer();
    setShowVictory(false);
    setActiveDay(day);
  }

  // Return to the hub from the board view.
  function backToHub(): void {
    clearVictoryTimer();
    setShowVictory(false);
    setActiveDay(undefined);
  }

  // ── Board view ──────────────────────────────────────────────────────────────
  if (activeView !== undefined) {
    const label = activeView.gmRating !== undefined
      ? `GM ${activeView.gmName} (${activeView.gmRating})`
      : `GM ${activeView.gmName}`;

    const descriptionFull = (
      <>In this position, {label} played <strong>{activeView.blunder.move_san}</strong> — {activeView.explanation}.</>
    );
    const descriptionShort = (
      <>GM {activeView.gmName} played <strong>{activeView.blunder.move_san}</strong> — {activeView.explanation}.</>
    );

    const header = (
      <header className="daily__board-hdr">
        <button type="button" className="daily__back-btn" onClick={backToHub}>
          ‹ Back
        </button>
        <span className="daily__board-hdr-date">{activeView.dateLabel}</span>
      </header>
    );

    // Mark solved and celebrate on the first best move at the blunder position.
    // The modal is delayed briefly so the winning move is seen on the board
    // before the celebration takes over the screen.
    function handleSolved(): void {
      markSolved(activeView!.day);
      clearVictoryTimer();
      victoryTimerRef.current = window.setTimeout(() => {
        setShowVictory(true);
      }, 900);
    }

    return (
      <>
        <TrainerBoard
          blunder={activeView.blunder}
          isMobile={isMobile}
          header={header}
          onMenu={backToHub}
          descriptionFull={descriptionFull}
          descriptionShort={descriptionShort}
          onSolved={handleSolved}
        />

        {showVictory && (
          <div className="daily-victory" role="dialog" aria-modal="true">
            <div className="daily-victory__card">
              <div className="daily-victory__burst">♛</div>
              <span className="daily-victory__eyebrow">Puzzle solved</span>
              <h2 className="daily-victory__title">You found the move!</h2>
              <p className="daily-victory__msg">
                You punished GM {activeView.gmName}'s blunder — nicely spotted.
              </p>

              <div className="daily-victory__actions">
                <button type="button" className="daily-victory__btn daily-victory__btn--primary" onClick={backToHub}>
                  Back to puzzles 
                </button>
                <button type="button" className="daily-victory__btn" onClick={() => setShowVictory(false)}>
                  Review the position
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // ── Hub view ──────────────────────────────────────────────────────────────
  const todaySolved = solvedSet.has(today.day);

  return (
    <div className={`daily-hub${isMobile ? ' daily-hub--mobile' : ''}`}>
      {/* Hero — today's puzzle */}
      <section className={`daily-hero${todaySolved ? ' daily-hero--solved' : ''}`}>
        <div className="daily-hero__body">
          <div className="daily-hero__eyebrow-row">
            <span className="daily-hero__eyebrow">Blunder of the Day</span>
            <span className="daily-hero__date">{today.dateLabel}</span>
          </div>

          <h1 className="daily-hero__title">
            Can you punish {`GM ${today.gmName}`}?
          </h1>

          <p className="daily-hero__desc">
            A {today.gmRating !== undefined ? <><strong>{today.gmRating}</strong>-rated </> : undefined}
            Grandmaster slipped up here — they played{' '}
            <strong>{today.blunder.move_san}</strong>, {today.explanation}. Find the move they missed.
          </p>

          <div className="daily-hero__meta">
            <span
              className="daily-hero__pill"
              style={today.categoryStyle}
            >
              {today.categoryLabel}
            </span>
          </div>
        </div>

        <div className="daily-hero__thumb-wrap">
          <img className="daily-hero__thumb" src={today.thumb} alt="Today's blunder position" />
          {todaySolved && <span className="daily-hero__thumb-badge">✓ Solved</span>}
        </div>

        <button
          type="button"
          className="daily-hero__cta"
          onClick={() => openPuzzle(today.day)}
        >
          {todaySolved ? 'Review today’s puzzle' : 'Try to solve it'}
        </button>
      </section>

      {/* Previous puzzles — inline list in a clean white panel */}
      {past.length > 0 && (
        <section className="daily-history">
          <h2 className="daily-history__title">Previous puzzles</h2>

          <div className="daily-list">
            {past.map((view, index) => {
              const solved = solvedSet.has(view.day);

              return (
                <button
                  type="button"
                  className="daily-list-row"
                  key={`daily-${view.day}-${index}`}
                  onClick={() => openPuzzle(view.day)}
                >
                  <img className="daily-list-row__thumb" src={view.thumb} alt={`Blunder from ${view.dateLabel}`} />

                  <div className="daily-list-row__info">
                    <span className="daily-list-row__gm">GM {view.gmName}</span>
                    <span className="daily-list-row__cat" style={{ color: view.categoryStyle.color }}>
                      {view.categoryLabel}
                    </span>
                  </div>

                  <span className="daily-list-row__date">{view.dateLabel}</span>

                  <span className={`daily-list-row__status${solved ? ' daily-list-row__status--solved' : ''}`}>
                    {solved ? '✓ Solved' : 'Unsolved'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

export default DailyBlunder;
