/** Modal summarising a single game's blunders broken down by category. */

import { useEffect } from 'react';
import type { JSX, MouseEvent } from 'react';
import { BLUNDER_CATEGORIES, UNCATEGORIZED_CATEGORY } from '../../constants/blunderCategories';
import './BlunderCountModal.css';

interface BlunderCountModalProps {
  isOpen: boolean;
  /** Total blunders in the game (for the header count). */
  total: number;
  /** Count of blunders per category key, e.g. { material_loss: 2 }. */
  categories: Record<string, number>;
  onClose: () => void;
}

function BlunderCountModal({ isOpen, total, categories, onClose }: BlunderCountModalProps): JSX.Element | null {
  // Close on Escape key.
  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent): void {
      if (e.key === 'Escape') {
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  function handleCardClick(e: MouseEvent<HTMLDivElement>): void {
    e.stopPropagation();
  }

  // Known categories in display order, plus the uncategorized fallback when present.
  const orderedCategories = [...BLUNDER_CATEGORIES, UNCATEGORIZED_CATEGORY];
  const rows = orderedCategories
    .map((category) => ({ category, count: categories[category.key] ?? 0 }))
    .filter((row) => row.count > 0);

  return (
    <div className="bcm-backdrop" onClick={onClose}>
      <div className="bcm-card" onClick={handleCardClick}>

        {/* Header */}
        <div className="bcm-header">
          <span className="bcm-header__title">Blunder breakdown</span>
          <span className="bcm-header__total">{total}</span>
          <button
            className="bcm-header__close"
            type="button"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Category rows */}
        <div className="bcm-rows">
          {rows.length === 0 && (
            <p className="bcm-empty">No categorized blunders in this game.</p>
          )}

          {rows.map(({ category, count }) => (
            <div className="bcm-row" key={`bcm-${category.key}`}>
              <span
                className="bcm-row__pill"
                style={{ color: category.color, background: category.bg, borderColor: category.border }}
              >
                <span className="bcm-row__dot" style={{ background: category.color }} />
                {category.label}
              </span>
              <span className="bcm-row__count">{count}</span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

export default BlunderCountModal;
