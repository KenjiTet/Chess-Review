/** Loading screen — live progress while the backend analyses games. */

import type { JSX } from 'react';
import useSession from '../../hooks/useSession';
import './Loading.css';

function Loading(): JSX.Element {
  const loadingPct = useSession((s) => s.loadingPct);
  const loadingStatus = useSession((s) => s.loadingStatus);

  return (
    <div className="loading">
      <span className="loading__icon">♚</span>
      <h2 className="loading__title">Analysing your games…</h2>

      <div className="loading__bar-track">
        <div className="loading__bar-fill" style={{ width: `${loadingPct}%` }} />
      </div>

      <p className="loading__pct">{loadingPct}%</p>
      <p className="loading__status">{loadingStatus}</p>
    </div>
  );
}

export default Loading;
