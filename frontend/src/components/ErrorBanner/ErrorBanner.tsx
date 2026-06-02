/** Dismissible error banner — rendered at the top of the app when error is set. */

import type { JSX } from 'react';
import useSession from '../../hooks/useSession';
import './ErrorBanner.css';

function ErrorBanner(): JSX.Element | null {
  const error = useSession((s) => s.error);
  const clearError = useSession((s) => s.clearError);

  if (!error) {
    return null;
  }

  return (
    <div className="error-banner" role="alert">
      <span className="error-banner__message">{error}</span>
      <button className="error-banner__dismiss" onClick={clearError} type="button" aria-label="Dismiss error">
        ×
      </button>
    </div>
  );
}

export default ErrorBanner;
