/** Blunder-category filter — toggle pills + a "show games without blunders" switch. */

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
}

function CategoryFilter({ selected, onToggle, showClean, onToggleClean }: CategoryFilterProps): JSX.Element {
  return (
    <div className="catfilter">
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

      <label className="catfilter__clean">
        <input
          type="checkbox"
          checked={showClean}
          onChange={(e) => onToggleClean(e.target.checked)}
        />
        Show games without blunders
      </label>
    </div>
  );
}

export default CategoryFilter;
