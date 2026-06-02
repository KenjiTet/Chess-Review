/** Loading screen — live progress while the backend analyses games. */

import { useState, useEffect } from 'react';
import type { JSX } from 'react';
import useSession from '../../hooks/useSession';
import './Loading.css';

function Loading(): JSX.Element {
  const loadingPct = useSession((s) => s.loadingPct);
  const loadingStatus = useSession((s) => s.loadingStatus);

  // Smoothly animate the displayed percentage so it doesn't freeze during
  // long synchronous Stockfish analysis (which emits no SSE events).
  const [displayPct, setDisplayPct] = useState<number>(loadingPct);

  // Snap forward immediately whenever a real SSE update arrives.
  if (loadingPct > displayPct) {
    setDisplayPct(loadingPct);
  }

  // Slowly advance the displayed bar while the real pct is stalled.
  // Cap at (realPct + 25) so it never outrun the actual progress by much.
  useEffect(() => {
    if (loadingPct >= 100 || displayPct >= 95) {
      return undefined;
    }

    const ceiling = Math.min(loadingPct + 25, 95);

    if (displayPct >= ceiling) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setDisplayPct((prev) => Math.min(prev + 0.4, ceiling));
    }, 250);

    return () => clearTimeout(timer);
  }, [displayPct, loadingPct]);

  const shownPct = Math.round(displayPct);

  return (
    <div className="loading">
      <span className="loading__icon">♚</span>
      <h2 className="loading__title">Analysing your games…</h2>

      <div className="loading__bar-track">
        <div className="loading__bar-fill" style={{ width: `${displayPct}%` }} />
      </div>

      <p className="loading__pct">{shownPct}%</p>
      <p className="loading__status">{loadingStatus}</p>
    </div>
  );
}

export default Loading;
