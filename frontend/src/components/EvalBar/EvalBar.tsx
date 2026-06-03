/** Evaluation bar — vertical (sidebar) or horizontal (mobile strip above board). */

import type { JSX } from 'react';
import './EvalBar.css';

interface EvalBarProps {
  /** Centipawn score from white's POV (positive = white winning). */
  cpScore: number;
  /** Which side the player is on; determines which colour sits at the bottom/left. */
  orientation: 'white' | 'black';
  /** Render as a horizontal strip instead of the default vertical bar. */
  horizontal?: boolean;
}

function capScore(cp: number): string {
  if (Math.abs(cp) >= 3000) {
    return 'M';
  }
  return (Math.abs(cp) / 100).toFixed(1);
}

function EvalBar({ cpScore, orientation, horizontal = false }: EvalBarProps): JSX.Element {
  const clamped = Math.max(-1000, Math.min(1000, cpScore));
  const whitePct = 50 + (clamped / 1000) * 50;
  const blackPct = 100 - whitePct;
  const scoreLabel = capScore(cpScore);
  const isWhiteWinning = cpScore >= 0;

  if (horizontal) {
    // Horizontal strip: white fills from left when playing as white, from right when black
    const leftColor = orientation === 'white' ? '#f0ede5' : '#1a1a1a';
    const rightColor = orientation === 'white' ? '#1a1a1a' : '#f0ede5';
    const leftPct = orientation === 'white' ? whitePct : blackPct;

    return (
      <div className="eval-bar eval-bar--horizontal" aria-label={`Evaluation: ${scoreLabel} ${isWhiteWinning ? 'white' : 'black'}`}>
        <div className="eval-bar__track eval-bar__track--horizontal">
          <div
            className="eval-bar__left"
            style={{ width: `${leftPct}%`, background: leftColor }}
          />
          <div
            className="eval-bar__right"
            style={{ flex: 1, background: rightColor }}
          />
        </div>
        <span className="eval-bar__score eval-bar__score--horizontal">
          {isWhiteWinning ? '+' : '−'}{scoreLabel}
        </span>
      </div>
    );
  }

  // Vertical bar: black sits at top, white at bottom when player is white.
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
