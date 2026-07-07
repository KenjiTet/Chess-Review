/** Password-reset screen — reached from an emailed `?reset=<token>` link.
 *
 * Public (works when logged out). Collects a new password, submits it with the
 * token, then routes the user back to log in.
 */

import { useState } from 'react';
import type { JSX } from 'react';
import { resetPassword } from '../../api/client';
import useSession from '../../hooks/useSession';
import './ResetPassword.css';

interface ResetPasswordProps {
  token: string;
}

/** Client-side mirror of the backend password policy (>= 8 chars, at least one digit). */
function passwordPolicyError(password: string): string | undefined {
  const hasDigit = /\d/.test(password);

  if (password.length < 8 || !hasDigit) {
    return 'Password must be at least 8 characters and include a digit.';
  }

  return undefined;
}

function ResetPassword(props: ResetPasswordProps): JSX.Element {
  const { token } = props;
  const setScreen = useSession((s) => s.setScreen);
  const [password, setPassword] = useState<string>('');
  const [confirm, setConfirm] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [done, setDone] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();

    const policyError = passwordPolicyError(password);

    if (policyError) {
      setError(policyError);
      return;
    }

    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="reset">
      <div className="reset__card">
        <h2 className="reset__title">Reset your password</h2>

        {done ? (
          <>
            <p className="reset__notice">Your password has been reset. You can now log in.</p>
            <button type="button" className="reset__btn" onClick={() => setScreen('setup')}>
              Go to log in
            </button>
          </>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="reset__form">
            <div className="reset__field">
              <label className="reset__label" htmlFor="reset-password">New password</label>
              <input
                id="reset-password"
                className="reset__input"
                type="password"
                placeholder="At least 8 characters, incl. a digit..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
                required
              />
            </div>

            <div className="reset__field">
              <label className="reset__label" htmlFor="reset-confirm">Confirm password</label>
              <input
                id="reset-confirm"
                className="reset__input"
                type="password"
                placeholder="Re-enter your new password..."
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            {error && <p className="reset__error">{error}</p>}

            <button className="reset__btn" type="submit" disabled={loading}>
              {loading ? 'Please wait...' : 'Set new password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default ResetPassword;
