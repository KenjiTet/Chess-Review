/** Blunder info card — shown above the board in the trainer screen. */

import type { JSX } from 'react';
import './BlunderCard.css';

interface BlunderCardProps {
  moveSan: string;
  cpLoss: number;
  classification: string;
  onShowBlunderSequence?: () => void;
  sequenceDisabled?: boolean;
  /** When true renders a short "Show" label on the sequence button instead of the full text. */
  compactSequenceLabel?: boolean;
}

function capCpLoss(cpLoss: number): string {
  if (cpLoss >= 3000) {
    return '999+';
  }
  return String(cpLoss);
}

function BlunderCard({ moveSan, cpLoss, classification, onShowBlunderSequence, sequenceDisabled, compactSequenceLabel = false }: BlunderCardProps): JSX.Element {
  return (
    <div className="blunder-card">
      <div className="blunder-card__meta">
        <span className={`blunder-card__badge blunder-card__badge--${classification}`}>
          {classification}
        </span>
      </div>
      <div className="blunder-card__body">
        <p className="blunder-card__prompt">
          In this game you played <strong>{moveSan}</strong> — a {classification}{' '}
          (cp loss: {capCpLoss(cpLoss)}). <em>What would you have played instead?</em>
        </p>
        {onShowBlunderSequence && (
          <button
            className="blunder-card__sequence-btn"
            type="button"
            onClick={onShowBlunderSequence}
            disabled={sequenceDisabled}
            title="Show move sequence"
          >
            {compactSequenceLabel ? '▶ Show' : '▶ Show Move Sequence'}
          </button>
        )}
      </div>
    </div>
  );
}

export default BlunderCard;
