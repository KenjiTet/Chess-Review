/** Popover summarising a single game's blunders broken down by category. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { BLUNDER_CATEGORIES, UNCATEGORIZED_CATEGORY } from '../../constants/blunderCategories';
import './BlunderCountModal.css';

interface BlunderCountModalProps {
  isOpen: boolean;
  /** Element the popover anchors to (the clicked blunder count). */
  anchor?: HTMLElement;
  /** Total blunders in the game (for the header count). */
  total: number;
  /** Count of blunders per category key, e.g. { material_loss: 2 }. */
  categories: Record<string, number>;
  /** Currently-selected filter keys; rows outside this set are greyed out. */
  selectedCategories?: Set<string>;
  onClose: () => void;
}

/** Resolved popover placement, in viewport-fixed coordinates. */
interface PopoverPosition {
  top: number;
  left: number;
  /** Horizontal offset of the pointer arrow inside the card. */
  arrowLeft: number;
  /** Whether the card sits above the anchor (arrow points down). */
  above: boolean;
}

// Gap in px between the anchor and the popover card.
const ANCHOR_GAP = 8;

// Minimum margin to keep between the popover and the viewport edges.
const VIEWPORT_MARGIN = 8;

function BlunderCountModal({ isOpen, anchor, total, categories, selectedCategories, onClose }: BlunderCountModalProps): JSX.Element | null {
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopoverPosition | undefined>(undefined);

  // Measure the anchor + card and resolve a placement (below, or above when
  // there is not enough room below). Re-runs whenever the popover opens.
  useLayoutEffect(() => {
    if (!isOpen || anchor === undefined) {
      setPosition(undefined);
      return undefined;
    }

    function reposition(): void {
      const card = cardRef.current;

      if (card === null || anchor === undefined) {
        return;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const cardWidth = card.offsetWidth;
      const cardHeight = card.offsetHeight;

      // Default: drop the card below the anchor.
      let above = false;
      let top = anchorRect.bottom + ANCHOR_GAP;

      const overflowsBelow = top + cardHeight > window.innerHeight - VIEWPORT_MARGIN;
      const fitsAbove = anchorRect.top - ANCHOR_GAP - cardHeight > VIEWPORT_MARGIN;

      // Flip above the anchor when it would otherwise clip the bottom edge.
      if (overflowsBelow && fitsAbove) {
        above = true;
        top = anchorRect.top - ANCHOR_GAP - cardHeight;
      }

      // Centre horizontally on the anchor, then clamp inside the viewport.
      const anchorCentre = anchorRect.left + anchorRect.width / 2;
      const minLeft = VIEWPORT_MARGIN;
      const maxLeft = window.innerWidth - cardWidth - VIEWPORT_MARGIN;
      const left = Math.max(minLeft, Math.min(anchorCentre - cardWidth / 2, maxLeft));

      // Keep the arrow pointing at the anchor centre after clamping.
      const arrowLeft = Math.max(14, Math.min(anchorCentre - left, cardWidth - 14));

      setPosition({ top, left, arrowLeft, above });
    }

    reposition();

    // Recompute on resize so the popover tracks layout changes while open.
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [isOpen, anchor]);

  // Close on Escape, on any outside pointer press, and on scroll.
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handleKeyDown(e: globalThis.KeyboardEvent): void {
      if (e.key === 'Escape') {
        onClose();
      }
    }

    function handlePointerDown(e: globalThis.MouseEvent): void {
      const card = cardRef.current;

      // Ignore presses inside the card itself; everything else dismisses it.
      if (card !== null && e.target instanceof Node && card.contains(e.target)) {
        return;
      }

      onClose();
    }

    function handleScroll(): void {
      onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  // Known categories in display order, plus the uncategorized fallback when present.
  const orderedCategories = [...BLUNDER_CATEGORIES, UNCATEGORIZED_CATEGORY];

  // Sum of every categorised blunder. Any shortfall against the game's total is
  // surfaced as uncategorized so the rows always add up to the header count.
  const categorisedTotal = orderedCategories
    .filter((category) => category.key !== UNCATEGORIZED_CATEGORY.key)
    .reduce((sum, category) => sum + (categories[category.key] ?? 0), 0);

  const storedUncategorized = categories[UNCATEGORIZED_CATEGORY.key] ?? 0;
  const remainder = Math.max(0, total - categorisedTotal);
  const uncategorizedCount = Math.max(storedUncategorized, remainder);

  const rows = orderedCategories
    .map((category) => {
      // Override the uncategorized bucket with the reconciled remainder.
      if (category.key === UNCATEGORIZED_CATEGORY.key) {
        return { category, count: uncategorizedCount };
      }
      return { category, count: categories[category.key] ?? 0 };
    })
    .filter((row) => row.count > 0);

  return (
    <div
      ref={cardRef}
      className={`bcm-card${position?.above === true ? ' bcm-card--above' : ''}`}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        // Hide until the first measure resolves a real position.
        visibility: position === undefined ? 'hidden' : 'visible',
      }}
    >
      {/* Pointer arrow connecting the card to the anchored count. */}
      <span className="bcm-arrow" style={{ left: position?.arrowLeft ?? 0 }} />

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

        {rows.map(({ category, count }) => {
          // Grey out a filterable type that is currently deselected.
          const isFilteredOut = category.key !== UNCATEGORIZED_CATEGORY.key
            && selectedCategories !== undefined
            && !selectedCategories.has(category.key);

          return (
            <div className={`bcm-row${isFilteredOut ? ' bcm-row--off' : ''}`} key={`bcm-${category.key}`}>
              <span
                className="bcm-row__pill"
                style={{ color: category.color, background: category.bg, borderColor: category.border }}
              >
                <span className="bcm-row__dot" style={{ background: category.color }} />
                {category.label}
              </span>
              <span className="bcm-row__count">{count}</span>
            </div>
          );
        })}
      </div>

    </div>
  );
}

export default BlunderCountModal;
