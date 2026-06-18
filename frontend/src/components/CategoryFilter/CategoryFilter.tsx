/** Blunder-category filter — title + toggle pills + game-visibility switches. */

import type { JSX } from 'react';
import { BLUNDER_CATEGORIES } from '../../constants/blunderCategories';
import './CategoryFilter.css';

interface CategoryFilterProps {
  /** Currently-selected category keys. */
  selected: Set<string>;
  /** Toggle a single category on/off. */
  onToggle: (key: string) => void;
  /** Whether games with zero blunders are shown. */
  showClean: boolean;
  /** Toggle the show-clean-games switch. */
  onToggleClean: (value: boolean) => void;
  /** Whether already-reviewed games are shown. */
  showReviewed: boolean;
  /** Toggle the show-reviewed-games switch. */
  onToggleReviewed: (value: boolean) => void;
  /** Whether analysed games are shown. */
  showAnalysed: boolean;
  /** Toggle the show-analysed-games switch. */
  onToggleAnalysed: (value: boolean) => void;
  /** Mobile layout stacks the switches above the blunder types. */
  isMobile?: boolean;
}

function CategoryFilter({
  selected,
  onToggle,
  showClean,
  onToggleClean,
  showReviewed,
  onToggleReviewed,
  showAnalysed,
  onToggleAnalysed,
  isMobile = false,
}: CategoryFilterProps): JSX.Element {
  // The three game-visibility switches, rendered as a group in both layouts.
  const switches = (
    <div className="catfilter__switches">
      <span className="catfilter__title">Display</span>
      <label className="catfilter__switch">
        <input type="checkbox" checked={showClean} onChange={(e) => onToggleClean(e.target.checked)} />
        Show games without blunders
      </label>
      <label className="catfilter__switch">
        <input type="checkbox" checked={showReviewed} onChange={(e) => onToggleReviewed(e.target.checked)} />
        Show already reviewed games
      </label>
      <label className="catfilter__switch">
        <input type="checkbox" checked={showAnalysed} onChange={(e) => onToggleAnalysed(e.target.checked)} />
        Show analysed games
      </label>
    </div>
  );

  // Title + the blunder-type pills.
  const types = (
    <div className="catfilter__types">
      <span className="catfilter__title">Type of Blunder to review</span>
      <div className="catfilter__pills">
        {BLUNDER_CATEGORIES.map((category) => {
          const isActive = selected.has(category.key);

          // Active pills use the category accent; inactive ones are muted/outlined.
          const pillStyle = isActive
            ? { color: category.color, background: category.bg, borderColor: category.border }
            : undefined;

          return (
            <button
              key={`catfilter-${category.key}`}
              type="button"
              className={`catfilter__pill${isActive ? ' catfilter__pill--on' : ''}`}
              style={pillStyle}
              aria-pressed={isActive}
              onClick={() => onToggle(category.key)}
            >
              <span className="catfilter__dot" style={{ background: category.color }} />
              {category.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  // Types first in both layouts: desktop places types left / switches right;
  // mobile stacks the Display switches below the blunder types.
  return (
    <div className={`catfilter${isMobile ? ' catfilter--mobile' : ''}`}>
      {types}
      {switches}
    </div>
  );
}

export default CategoryFilter;
