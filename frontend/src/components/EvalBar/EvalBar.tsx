/** Vertical evaluation bar — player's colour fills from the bottom. */

import type { JSX } from 'react';
import './EvalBar.css';

interface EvalBarProps {
  /** Centipawn score from white's POV (positive = white winning). */
  cpScore: number;
  /** Which side the player is on; determines which colour sits at the bottom. */
  orientation: 'white' | 'black';
}

function capScore(cp: number): string {
  if (Math.abs(cp) >= 3000) {
    return 'M';
  }
  return (Math.abs(cp) / 100).toFixed(1);
}

function EvalBar({ cpScore, orientation }: EvalBarProps): JSX.Element {
  const clamped = Math.max(-1000, Math.min(1000, cpScore));
  const whitePct = 50 + (clamped / 1000) * 50;
  const blackPct = 100 - whitePct;
  const scoreLabel = capScore(cpScore);
  const isWhiteWinning = cpScore >= 0;

  // When playing as black the board is flipped, so black sits at the bottom —
  // render the black segment last so it occupies the bottom of the flex column.
  const blackFirst = orientation === 'white';

  return (
    <div className="eval-bar" aria-label={`Evaluation: ${scoreLabel} ${isWhiteWinning ? 'white' : 'black'}`}>
      <div className="eval-bar__track">
        {blackFirst ? (
          <>
            <div className="eval-bar__black" style={{ height: `${blackPct}%` }} />
            <div className="eval-bar__white" style={{ height: `${whitePct}%` }} />
          </>
        ) : (
          <>
            <div className="eval-bar__white" style={{ height: `${whitePct}%` }} />
            <div className="eval-bar__black" style={{ height: `${blackPct}%` }} />
          </>
        )}
      </div>
      <span className="eval-bar__score">
        {scoreLabel}
      </span>
    </div>
  );
}

export default EvalBar;
