/**
 * Trainer screen — shows one blunder at a time within a training session.
 *
 * The interactive board, tools panel and all drilling behaviour live in the
 * shared TrainerBoard component; this screen wraps it with the session chrome:
 * progress tracking, the next / skip / finish actions and the session-complete
 * modal.
 */

import { useState } from 'react';
import type { JSX } from 'react';
import useSession from '../../hooks/useSession';
import useSettings from '../../hooks/useSettings';
import TrainerBoard from '../TrainerBoard/TrainerBoard';
import ThresholdPicker from '../ThresholdPicker/ThresholdPicker';
import menuIconUrl from '../../assets/menu_icon.svg';
import doneIconUrl from '../../assets/done_icon.svg';
import './Trainer.css';
import './Trainer.mobile.css';

/** Inline SVG chess pawn — replaces the ♟ emoji to avoid font-rendering variance. */
function PawnIcon({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 9c2.67 0 8 1.34 8 4v1H4v-1c0-2.66 5.33-4 8-4zM9 17h6l1.5 5H7.5L9 17z"/>
    </svg>
  );
}

interface TrainerProps {
  isMobile?: boolean;
}

function Trainer({ isMobile = false }: TrainerProps): JSX.Element {
  const currentBlunder = useSession((s) => s.currentBlunder);
  const reviewedCount = useSession((s) => s.reviewedCount);
  const blunderCount = useSession((s) => s.blunderCount);
  const sessionId = useSession((s) => s.sessionId);
  const sessionDone = useSession((s) => s.sessionDone);
  const sessionDoneReason = useSession((s) => s.sessionDoneReason);
  const lastSessionRequest = useSession((s) => s.lastSessionRequest);
  const submitAttempt = useSession((s) => s.submitAttempt);
  const skipBlunder = useSession((s) => s.skipBlunder);
  const buildSession = useSession((s) => s.buildSession);
  const reset = useSession((s) => s.reset);

  const threshold = useSettings((s) => s.threshold);
  const setThreshold = useSettings((s) => s.setThreshold);

  // The shared board owns the played-move state; it reports the current first
  // move here so the Skip/Next action can switch accordingly.
  const [firstMove, setFirstMove] = useState<string | null>(null);

  // ── Session done modal actions ──────────────────────────────────────────────
  function handleReviewNextGame(): void {
    if (!lastSessionRequest) {
      reset();
      return;
    }

    void buildSession({ ...lastSessionRequest, game_url: undefined });
  }

  function handleRetryWithThreshold(newThreshold: number): void {
    setThreshold(newThreshold);

    if (!lastSessionRequest) {
      reset();
      return;
    }

    void buildSession({ ...lastSessionRequest, threshold: newThreshold });
  }

  // ── Guard ───────────────────────────────────────────────────────────────────
  if (sessionDone) {
    return (
      <div className="trainer trainer--empty">
        <div className="trainer__done-overlay trainer__done-overlay--static">
          <div className="trainer__done-modal">
            <div className="trainer__done-icon"><PawnIcon size={32} /></div>
            <h2 className="trainer__done-title">
              {sessionDoneReason === 'no_blunders' ? 'Clean game!' : 'All blunders reviewed!'}
            </h2>
            <p className="trainer__done-msg">
              {sessionDoneReason === 'no_blunders'
                ? 'No blunders found in this game.'
                : 'No more blunders to review in this game.'}
            </p>

            {sessionDoneReason === 'no_blunders' && (
              <div className="trainer__done-threshold">
                <span className="trainer__done-threshold-label">Lower the threshold to find more blunders</span>
                <ThresholdPicker value={threshold} onChange={handleRetryWithThreshold} />
              </div>
            )}

            <div className="trainer__done-actions">
              <button
                className="trainer__done-btn trainer__done-btn--primary"
                type="button"
                onClick={handleReviewNextGame}
              >
                Next game
              </button>
              <button
                className="trainer__done-btn"
                type="button"
                onClick={reset}
              >
                Back to menu
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!currentBlunder) {
    return (
      <div className="trainer trainer--empty">
        <p className="trainer__empty-msg">Loading next blunder…</p>
      </div>
    );
  }

  const progressPct = blunderCount > 0 ? ((reviewedCount + 1) / blunderCount) * 100 : 0;
  const isLastBlunder = reviewedCount + 1 >= blunderCount;

  // ── Submit the first played move to the backend ─────────────────────────────
  function handleNext(): void {
    if (sessionId === undefined) {
      reset();
      return;
    }
    if (firstMove !== null) {
      submitAttempt(firstMove);
    }
  }

  const finishContent = (
    <>
      <img className="trainer__panel-btn-svg" src={doneIconUrl} alt="" />
      Finish
    </>
  );

  // ── Contextual action (Skip until a move is played, then Next) ───────────────
  let desktopAction: JSX.Element;
  let mobileAction: { label: string; onClick: () => void; primary: boolean };

  if (sessionId === undefined) {
    // A stand-alone favourite / shared position — the only action is to leave.
    desktopAction = (
      <button
        className="trainer__panel-btn trainer__panel-btn--primary trainer__panel-btn--next trainer__panel-btn--icon"
        type="button"
        onClick={reset}
      >
        {finishContent}
      </button>
    );
    mobileAction = { label: 'Finish', onClick: reset, primary: true };
  } else if (firstMove === null) {
    // No move played yet — skipping moves on without recording an attempt.
    desktopAction = (
      <button
        className={`trainer__panel-btn trainer__panel-btn--next${isLastBlunder ? ' trainer__panel-btn--primary trainer__panel-btn--icon' : ''}`}
        type="button"
        onClick={skipBlunder}
      >
        {isLastBlunder ? finishContent : <><span className="trainer__panel-btn-ic">▶▶</span>Skip</>}
      </button>
    );
    mobileAction = { label: isLastBlunder ? 'Finish' : 'Skip', onClick: skipBlunder, primary: isLastBlunder };
  } else {
    // A move has been played — submitting it advances to the reveal / next blunder.
    desktopAction = (
      <button
        className="trainer__panel-btn trainer__panel-btn--primary trainer__panel-btn--next trainer__panel-btn--icon"
        type="button"
        onClick={handleNext}
      >
        {isLastBlunder ? finishContent : <><span className="trainer__panel-btn-ic">▶▶</span>Next</>}
      </button>
    );
    mobileAction = { label: isLastBlunder ? 'Finish' : 'Next', onClick: handleNext, primary: true };
  }

  const desktopHeader = (
    <header className="trainer__header">
      <div className="trainer__progress-label">
        Blunder {reviewedCount + 1} / {blunderCount}
      </div>

      <button className="trainer__menu-btn" type="button" onClick={reset} title="Back to menu">
        <img className="trainer__menu-btn-ic" src={menuIconUrl} alt="" />
        Menu
      </button>
    </header>
  );

  return (
    <TrainerBoard
      blunder={currentBlunder}
      isMobile={isMobile}
      header={desktopHeader}
      progressPct={progressPct}
      onMenu={reset}
      desktopAction={desktopAction}
      mobileAction={mobileAction}
      onFirstMoveChange={setFirstMove}
    />
  );
}

export default Trainer;
