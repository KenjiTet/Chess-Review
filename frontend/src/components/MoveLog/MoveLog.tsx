/** Sidebar move-history panel with per-move quality badges. */

import { useRef, useEffect } from 'react';
import type { JSX } from 'react';
import './MoveLog.css';

export interface MoveLogEntry {
  id: number;
  san: string;
  classification: string | null;
  cpLoss: number | null;
  /** Side that played the move ('w' = white, 'b' = black) — drives the row tint. */
  side: 'w' | 'b';
}

const BADGE_COLORS: Record<string, string> = {
  best: '#22c55e',
  good: '#84cc16',
  inaccuracy: '#f59e0b',
  mistake: '#f97316',
  blunder: '#ef4444',
};

const BADGE_LABELS: Record<string, string> = {
  best: 'Best',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
};

interface MoveLogProps {
  entries: MoveLogEntry[];
}

function MoveLog({ entries }: MoveLogProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <div className="move-log">
      <div className="move-log__header">Move Feedback</div>
      <div className="move-log__scroll" ref={containerRef}>
      {entries.length === 0 ? (
        <div className="move-log__empty">Play a move to see feedback</div>
      ) : (
        <div className="move-log__list">
          {entries.map((entry) => {
            const color = entry.classification !== null ? BADGE_COLORS[entry.classification] : undefined;
            const label = entry.classification !== null ? BADGE_LABELS[entry.classification] : null;

            // Slight side-coded background so the player side reads at a glance.
            const sideClass = entry.side === 'w'
              ? 'move-log__entry--white'
              : 'move-log__entry--black';

            return (
              <div
                key={`move-log-entry-${entry.id}`}
                className={`move-log__entry ${sideClass}`}
                style={color !== undefined ? { borderLeftColor: color } : undefined}
              >
                <span className="move-log__san">{entry.san}</span>
                {label !== null && color !== undefined ? (
                  <span
                    className="move-log__badge"
                    style={{ color, borderColor: `${color}55` }}
                  >
                    {label}
                  </span>
                ) : (
                  <span className="move-log__pending">⏳</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}

export default MoveLog;
