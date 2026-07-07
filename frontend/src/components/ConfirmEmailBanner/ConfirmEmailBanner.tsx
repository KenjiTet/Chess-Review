/** Soft email-confirmation banner.
 *
 * Shown to logged-in password accounts whose email isn't confirmed yet. The user
 * can keep using the app; this just nudges them and offers to resend the link.
 * Dismissible for the current session only (returns on next load until confirmed).
 */

import { useState } from 'react';
import type { JSX } from 'react';
import { resendConfirmation } from '../../api/client';
import useAuth from '../../hooks/useAuth';
import './ConfirmEmailBanner.css';

function ConfirmEmailBanner(): JSX.Element | undefined {
  const email = useAuth((s) => s.email);
  const emailVerified = useAuth((s) => s.emailVerified);
  const isGuest = useAuth((s) => s.isGuest);
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);

  // Only relevant for confirmed-by-email accounts that haven't confirmed yet.
  const shouldShow = email !== undefined && !emailVerified && !isGuest && !dismissed;

  if (!shouldShow) {
    return undefined;
  }

  async function handleResend(): Promise<void> {
    setSending(true);
    setStatus('');

    try {
      const res = await resendConfirmation();
      setStatus(res.message);
    } catch {
      setStatus('Could not send the email. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="confirm-banner" role="status">
      <span className="confirm-banner__text">
        Please confirm your email ({email}) to secure your account.
      </span>

      <div className="confirm-banner__actions">
        {status && <span className="confirm-banner__status">{status}</span>}
        <button
          type="button"
          className="confirm-banner__resend"
          disabled={sending}
          onClick={() => void handleResend()}
        >
          {sending ? 'Sending...' : 'Resend'}
        </button>
        <button
          type="button"
          className="confirm-banner__dismiss"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default ConfirmEmailBanner;
