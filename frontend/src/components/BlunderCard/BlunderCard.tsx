/** Blunder info card — shown above the board in the trainer screen. */

import type { JSX } from 'react';
import { DEFAULT_BLUNDER_CATEGORY, getBlunderCategory } from '../../constants/blunderCategories';
import './BlunderCard.css';

interface BlunderCardProps {
  moveSan: string;
  cpLoss: number;
  /** Blunder type key — renders a coloured category pill in the meta area. */
  category?: string;
  onShowBlunderSequence?: () => void;
  /** Plays the winning line the player missed (only for missed_gain / missed_mate). */
  onShowBestSequence?: () => void;
  sequenceDisabled?: boolean;
  /** When true renders a short "Show" label on the sequence button instead of the full text. */
  compactSequenceLabel?: boolean;
  /** When true renders a compact prompt: "You played X — <category>." */
  compactPrompt?: boolean;
}

function capCpLoss(cpLoss: number): string {
  if (cpLoss >= 3000) {
    return '999+';
  }
  return String(cpLoss);
}

// Label for the blue "show the line you missed" button, by category.
function bestSequenceLabel(categoryKey: string | undefined, compact: boolean): string | undefined {
  if (categoryKey === 'missed_gain') {
    return compact ? '▶ Gain' : '▶ Show Gain';
  }
  if (categoryKey === 'missed_mate') {
    return compact ? '▶ Mate' : '▶ Show Mate';
  }
  return undefined;
}

function BlunderCard({ moveSan, cpLoss, category, onShowBlunderSequence, onShowBestSequence, sequenceDisabled, compactSequenceLabel = false, compactPrompt = false }: BlunderCardProps): JSX.Element {
  // Resolve the category to its label/colour; the prompt text still falls back
  // to a generic message when there's no displayable category.
  const categoryInfo = category !== undefined ? getBlunderCategory(category) : undefined;
  // The pill always shows — default to the red "Blunder" pill when uncategorized.
  const pillInfo = categoryInfo ?? DEFAULT_BLUNDER_CATEGORY;
  const bestLabel = bestSequenceLabel(category, compactSequenceLabel);

  return (
    <div className="blunder-card">
      <div className="blunder-card__meta">
        <span
          className="blunder-card__category"
          style={{ color: pillInfo.color, background: pillInfo.bg, borderColor: pillInfo.border }}
        >
          {pillInfo.label}
        </span>
      </div>
      <div className="blunder-card__body">
        <p className="blunder-card__prompt">
          {compactPrompt
            ? <>You played <strong>{moveSan}</strong>{categoryInfo ? <> {categoryInfo.shortPrompt}</> : undefined}.</>
            : <>In this game you played <strong>{moveSan}</strong> — {categoryInfo ? categoryInfo.prompt : 'this was a blunder'}{' '}(cp loss: {capCpLoss(cpLoss)}).</>
          }
        </p>
        <div className="blunder-card__actions">
          {onShowBlunderSequence && (
            <button
              className="blunder-card__sequence-btn"
              type="button"
              onClick={onShowBlunderSequence}
              disabled={sequenceDisabled}
              title="Show move sequence"
            >
              {compactSequenceLabel ? '▶ Blunder' : '▶ Show Blunder'}
            </button>
          )}
          {onShowBestSequence && bestLabel !== undefined && (
            <button
              className="blunder-card__sequence-btn blunder-card__sequence-btn--best"
              type="button"
              onClick={onShowBestSequence}
              disabled={sequenceDisabled}
              title="Show the line you missed"
            >
              {bestLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default BlunderCard;
