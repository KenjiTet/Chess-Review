/** Info icon + modal explaining what blunder severity (cp threshold) means. */

import { useEffect, useState } from 'react';
import type { JSX, MouseEvent } from 'react';
import './SeverityInfo.css';

function SeverityInfo(): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);

  // Close the modal on Escape while it is open.
  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent): void {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function handleOpen(): void {
    setOpen(true);
  }

  function handleClose(): void {
    setOpen(false);
  }

  // Stop backdrop clicks that originate inside the card from closing the modal.
  function handleCardClick(e: MouseEvent<HTMLDivElement>): void {
    e.stopPropagation();
  }

  return (
    <>
      <button
        type="button"
        className="severity-info__btn"
        onClick={handleOpen}
        aria-label="What is blunder severity?"
        title="What is blunder severity?"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </button>

      {open && (
        <div className="severity-info__backdrop" onClick={handleClose}>
          <div className="severity-info__card" onClick={handleCardClick}>
            <div className="severity-info__header">
              <span className="severity-info__title">Blunder severity</span>
              <button
                type="button"
                className="severity-info__close"
                onClick={handleClose}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="severity-info__body">
              <p>
                Moves are scored in <b>centipawns (cp)</b> — hundredths of a pawn.
                The cp loss is how much your move worsened the position versus the
                engine's best move.
              </p>
              <p>
                The threshold sets the minimum cp loss for a mistake to count as a
                blunder. <b>200&nbsp;cp+</b> shows every move that lost at least two
                pawns of value; a higher number means only your worst blunders.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default SeverityInfo;
