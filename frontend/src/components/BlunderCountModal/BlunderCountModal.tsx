/** Popover summarising a single game's blunders broken down by phase and category. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { BLUNDER_CATEGORIES, BLUNDER_PHASES, UNCATEGORIZED_CATEGORY } from '../../constants/blunderCategories';
import type { BlunderCategory } from '../../constants/blunderCategories';
import './BlunderCountModal.css';

interface BlunderCountModalProps {
  isOpen: boolean;
  /** Element the popover anchors to (the clicked blunder count). */
  anchor?: HTMLElement;
  /** Total blunders in the game (for the header count). */
  total: number;
  /** Count of blunders per category key, e.g. { material_loss: 2 }. */
  categories: Record<string, number>;
  /** Blunders bucketed by game phase, then category, e.g. { opening: { material_loss: 1 } }. */
  phases?: Record<string, Record<string, number>>;
  /** Currently-selected filter keys; rows outside this set are greyed out. */
  selectedCategories?: Set<string>;
  /**
   * Open the trainer for one blunder type, optionally scoped to a phase.
   * phase is undefined when the "All" tab is active.
   */
  onTrainCategory?: (category: string, phase?: string) => void;
  onClose: () => void;
}

/** Resolved popover placement, in viewport-fixed coordinates. */
interface PopoverPosition {
  /** Distance from the viewport top — used when the card sits below the anchor. */
  top?: number;
  /** Distance from the viewport bottom — used when the card sits above the anchor. */
  bottom?: number;
  left: number;
  /** Horizontal offset of the pointer arrow inside the card. */
  arrowLeft: number;
  /** Whether the card sits above the anchor (arrow points down). */
  above: boolean;
  /** Frozen card height (px) — set only in the above placement to lock the layout. */
  height?: number;
}

/** Placement decided once per open, so phase switches never re-flip or jump the card. */
interface FrozenPlacement {
  above: boolean;
  /** Card height captured on the first (tallest, "All" tab) measure when above. */
  height?: number;
}

/** One displayable row: a category pill and its count. */
interface CategoryRow {
  category: BlunderCategory;
  count: number;
}

// Gap in px between the anchor and the popover card.
const ANCHOR_GAP = 8;

// Minimum margin to keep between the popover and the viewport edges.
const VIEWPORT_MARGIN = 8;

// Active phase tab — "all" aggregates every phase.
const ALL_PHASE = 'all';

// Keys that resolve to a displayable category pill (the rest fold into "uncategorized").
const KNOWN_CATEGORY_KEYS = new Set(BLUNDER_CATEGORIES.map((category) => category.key));

/**
 * Turn a {category -> count} map into displayable rows: one per known category,
 * plus a reconciled "uncategorized" bucket for everything else.
 *
 * reconcileTotal (the game/phase total) lets legacy games with no stored
 * breakdown still surface their blunders under uncategorized.
 */
function buildRows(counts: Record<string, number>, reconcileTotal?: number): CategoryRow[] {
  const knownRows: CategoryRow[] = BLUNDER_CATEGORIES.map((category) => {
    return { category, count: counts[category.key] ?? 0 };
  });

  const knownSum = knownRows.reduce((sum, row) => sum + row.count, 0);

  // Anything stored under a non-displayable key (e.g. positional) is uncategorized.
  const storedUnknown = Object.entries(counts)
    .filter(([key]) => !KNOWN_CATEGORY_KEYS.has(key))
    .reduce((sum, [, value]) => sum + value, 0);

  let uncategorized = storedUnknown;

  // Reconcile against the known total so the rows always add up to it.
  if (reconcileTotal !== undefined) {
    uncategorized = Math.max(storedUnknown, reconcileTotal - knownSum);
  }

  const rows: CategoryRow[] = [...knownRows, { category: UNCATEGORIZED_CATEGORY, count: Math.max(0, uncategorized) }];

  return rows.filter((row) => row.count > 0);
}

function BlunderCountModal({ isOpen, anchor, total, categories, phases, selectedCategories, onTrainCategory, onClose }: BlunderCountModalProps): JSX.Element | null {
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopoverPosition | undefined>(undefined);
  /** Active phase tab — "all" or one of the BLUNDER_PHASES keys. */
  const [activePhase, setActivePhase] = useState<string>(ALL_PHASE);
  /** Placement frozen on open; cleared so the next open re-decides above/below. */
  const placementRef = useRef<FrozenPlacement | undefined>(undefined);

  // Reset to the "All" tab each time the popover (re)opens on a new game, and
  // drop the frozen placement so the new anchor gets a fresh above/below decision.
  useEffect(() => {
    if (isOpen) {
      setActivePhase(ALL_PHASE);
      placementRef.current = undefined;
    }
  }, [isOpen, anchor]);

  // Measure the anchor + card and resolve a placement (below, or above when
  // there is not enough room below). Re-runs whenever the popover opens or the
  // active phase changes (the card height changes with the row count).
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

      // Decide above/below only once per open. The first measure happens on the
      // "All" tab, which carries every row and is therefore the tallest layout —
      // so freezing its height guarantees the card always fits above.
      let placement = placementRef.current;

      if (placement === undefined) {
        const overflowsBelow = anchorRect.bottom + ANCHOR_GAP + cardHeight > window.innerHeight - VIEWPORT_MARGIN;
        const fitsAbove = anchorRect.top - ANCHOR_GAP - cardHeight > VIEWPORT_MARGIN;
        const decidedAbove = overflowsBelow && fitsAbove;

        placement = { above: decidedAbove, height: decidedAbove ? cardHeight : undefined };
        placementRef.current = placement;
      }

      const above = placement.above;

      // Centre horizontally on the anchor, then clamp inside the viewport.
      const anchorCentre = anchorRect.left + anchorRect.width / 2;
      const minLeft = VIEWPORT_MARGIN;
      const maxLeft = window.innerWidth - cardWidth - VIEWPORT_MARGIN;
      const left = Math.max(minLeft, Math.min(anchorCentre - cardWidth / 2, maxLeft));

      // Keep the arrow pointing at the anchor centre after clamping.
      const arrowLeft = Math.max(14, Math.min(anchorCentre - left, cardWidth - 14));

      // Above: pin the bottom edge to the anchor and lock the height, so switching
      // phase tabs changes neither the card position nor the toggles' level.
      if (above) {
        const bottom = window.innerHeight - (anchorRect.top - ANCHOR_GAP);
        setPosition({ bottom, left, arrowLeft, above, height: placement.height });
        return;
      }

      // Below: pin the top edge; the card simply grows/shrinks downward.
      setPosition({ top: anchorRect.bottom + ANCHOR_GAP, left, arrowLeft, above });
    }

    reposition();

    // Recompute on resize so the popover tracks layout changes while open.
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [isOpen, anchor, activePhase]);

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

  // Show the phase tabs only when the game carries a per-phase breakdown.
  const hasPhaseData = phases !== undefined && Object.keys(phases).length > 0;

  // Phase tabs the game actually has blunders in, in canonical order.
  const availablePhases = BLUNDER_PHASES.filter((phase) => {
    const phaseCounts = phases?.[phase.key];
    return phaseCounts !== undefined && Object.values(phaseCounts).some((count) => count > 0);
  });

  // Resolve the rows for the active tab.
  let rows: CategoryRow[];

  if (activePhase === ALL_PHASE) {
    rows = buildRows(categories, total);
  } else {
    rows = buildRows(phases?.[activePhase] ?? {});
  }

  // The phase passed to the trainer — undefined on the "All" tab (train every phase).
  const trainPhase = activePhase === ALL_PHASE ? undefined : activePhase;

  function handlePillClick(category: BlunderCategory): void {
    // Only real, displayable types are trainable — the uncategorized bucket is a
    // reconciliation total, not a filterable category.
    if (onTrainCategory === undefined || category.key === UNCATEGORIZED_CATEGORY.key) {
      return;
    }

    onTrainCategory(category.key, trainPhase);
  }

  return (
    <div
      ref={cardRef}
      className={`bcm-card${position?.above === true ? ' bcm-card--above' : ''}`}
      style={{
        // Above pins the bottom edge (with a frozen height); below pins the top.
        top: position?.above === true ? undefined : position?.top ?? 0,
        bottom: position?.above === true ? position?.bottom ?? 0 : undefined,
        height: position?.height,
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

      {/* Phase tabs — only when the game has a per-phase breakdown. */}
      {hasPhaseData && availablePhases.length > 0 && (
        <div className="bcm-tabs">
          <button
            className={`bcm-tab${activePhase === ALL_PHASE ? ' bcm-tab--active' : ''}`}
            type="button"
            onClick={() => setActivePhase(ALL_PHASE)}
          >
            All
          </button>
          {availablePhases.map((phase) => (
            <button
              key={`bcm-tab-${phase.key}`}
              className={`bcm-tab${activePhase === phase.key ? ' bcm-tab--active' : ''}`}
              type="button"
              onClick={() => setActivePhase(phase.key)}
            >
              {phase.label}
            </button>
          ))}
        </div>
      )}

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

          // Only displayable types are clickable into the trainer.
          const isTrainable = onTrainCategory !== undefined && category.key !== UNCATEGORIZED_CATEGORY.key;

          return (
            <div
              className={`bcm-row${isFilteredOut ? ' bcm-row--off' : ''}${isTrainable ? ' bcm-row--clickable' : ''}`}
              key={`bcm-${category.key}`}
              role={isTrainable ? 'button' : undefined}
              tabIndex={isTrainable ? 0 : undefined}
              title={isTrainable ? 'Train these blunders' : undefined}
              onClick={isTrainable ? () => handlePillClick(category) : undefined}
              onKeyDown={isTrainable
                ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handlePillClick(category);
                  }
                }
                : undefined}
            >
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
