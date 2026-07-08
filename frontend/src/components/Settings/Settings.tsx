/** Account Settings screen — linked accounts, password change, theme, and deletion.
 *
 * Reached from the SessionSetup settings menu (and after a first Google sign-in
 * that still needs a linked handle).
 */

import { useState } from 'react';
import type { JSX } from 'react';
import { changePassword, deleteAccount, resendConfirmation, setAccountEmail as setAccountEmailApi } from '../../api/client';
import useAuth from '../../hooks/useAuth';
import useSettings from '../../hooks/useSettings';
import AccountManager from './AccountManager';
import './Settings.css';

/** Client-side mirror of the backend password policy (>= 8 chars, at least one digit). */
function passwordPolicyError(password: string): string | undefined {
  const hasDigit = /\d/.test(password);

  if (password.length < 8 || !hasDigit) {
    return 'Password must be at least 8 characters and include a digit.';
  }

  return undefined;
}

function Settings(): JSX.Element {
  const email = useAuth((s) => s.email);
  const emailVerified = useAuth((s) => s.emailVerified);
  const authProvider = useAuth((s) => s.authProvider);
  const setAccountEmailStore = useAuth((s) => s.setAccountEmail);
  const logout = useAuth((s) => s.logout);
  const darkMode = useSettings((s) => s.darkMode);
  const setDarkMode = useSettings((s) => s.setDarkMode);

  // Email add/change form state.
  const [newEmail, setNewEmail] = useState<string>('');
  const [emailError, setEmailError] = useState<string>('');
  const [emailNotice, setEmailNotice] = useState<string>('');
  const [emailLoading, setEmailLoading] = useState<boolean>(false);

  // Resend-confirmation state (shown when the current email is unconfirmed).
  const [resendStatus, setResendStatus] = useState<string>('');
  const [resendLoading, setResendLoading] = useState<boolean>(false);

  // Show the confirmation prompt only for password accounts that have set an
  // email which is not yet verified.
  const emailNeedsConfirm = authProvider !== 'google' && email !== undefined && !emailVerified;

  async function handleResendConfirmation(): Promise<void> {
    setResendLoading(true);
    setResendStatus('');

    try {
      const res = await resendConfirmation();
      setResendStatus(res.message);
    } catch {
      setResendStatus('Could not send the email. Please try again.');
    } finally {
      setResendLoading(false);
    }
  }

  // Change-password form state.
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [pwError, setPwError] = useState<string>('');
  const [pwNotice, setPwNotice] = useState<string>('');
  const [pwLoading, setPwLoading] = useState<boolean>(false);

  // Delete-account state.
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [deletePassword, setDeletePassword] = useState<string>('');
  const [deleteError, setDeleteError] = useState<string>('');
  const [deleteLoading, setDeleteLoading] = useState<boolean>(false);

  const isGoogleAccount = authProvider === 'google';

  async function handleSetEmail(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();

    if (!newEmail.trim()) {
      setEmailError('Enter an email address.');
      return;
    }

    setEmailError('');
    setEmailNotice('');
    setEmailLoading(true);

    try {
      const res = await setAccountEmailApi(newEmail.trim());
      // Reflect the new (unconfirmed) email in the store so the banner appears.
      setAccountEmailStore(newEmail.trim().toLowerCase());
      setEmailNotice(res.message);
      setNewEmail('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setEmailError(msg);
    } finally {
      setEmailLoading(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();

    const policyError = passwordPolicyError(newPassword);

    if (policyError) {
      setPwError(policyError);
      return;
    }

    if (newPassword !== confirmPassword) {
      setPwError('New passwords do not match.');
      return;
    }

    setPwError('');
    setPwNotice('');
    setPwLoading(true);

    try {
      const res = await changePassword(currentPassword, newPassword);
      setPwNotice(res.message);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setPwError(msg);
    } finally {
      setPwLoading(false);
    }
  }

  async function handleDelete(): Promise<void> {
    setDeleteError('');
    setDeleteLoading(true);

    try {
      // Password accounts must confirm with their password; Google accounts don't.
      await deleteAccount(isGoogleAccount ? undefined : deletePassword);
      logout();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setDeleteError(msg);
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="settings">
      <div className="settings__card">
        <h1 className="settings__title">Account settings</h1>

        {/* ── Email (add for legacy accounts, or change) ───────────────────── */}
        {!isGoogleAccount && (
          <section className="settings__section settings__section--first">
            <h2 className="settings__section-title">Email</h2>
            <p className="settings__email-current">
              {email
                ? <>Current: <strong>{email}</strong>{emailVerified ? ' (confirmed)' : ' (unconfirmed)'}</>
                : 'No email set yet — add one to enable password reset and recovery.'}
            </p>

            {/* Unconfirmed email → in-context confirmation prompt + resend. */}
            {emailNeedsConfirm && (
              <div className="settings__confirm" role="status">
                <span className="settings__confirm-text">
                  Please confirm your email to secure your account and enable password recovery.
                </span>
                <div className="settings__confirm-actions">
                  {resendStatus && <span className="settings__notice">{resendStatus}</span>}
                  <button
                    type="button"
                    className="settings__btn"
                    disabled={resendLoading}
                    onClick={() => void handleResendConfirmation()}
                  >
                    {resendLoading ? 'Sending...' : 'Resend confirmation email'}
                  </button>
                </div>
              </div>
            )}
            <form onSubmit={(e) => void handleSetEmail(e)} className="settings__form">
              <input
                className="settings__input"
                type="email"
                placeholder={email ? 'New email address' : 'you@example.com'}
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                autoComplete="email"
              />
              {emailError && <p className="settings__error">{emailError}</p>}
              {emailNotice && <p className="settings__notice">{emailNotice}</p>}
              <button type="submit" className="settings__btn" disabled={emailLoading}>
                {emailLoading ? 'Saving...' : email ? 'Change email' : 'Add email'}
              </button>
            </form>
          </section>
        )}

        {/* For Google accounts the email comes from Google and can't be changed here. */}
        {isGoogleAccount && email && (
          <section className="settings__section settings__section--first">
            <h2 className="settings__section-title">Email</h2>
            <p className="settings__email-current"><strong>{email}</strong> (via Google)</p>
          </section>
        )}

        {/* ── Linked accounts ─────────────────────────────────────────────── */}
        <section className="settings__section">
          <h2 className="settings__section-title">Chess accounts</h2>
          <p className="settings__hint">
            Tap a linked account to show its stats — recent games, win rate, avg blunders and ratings.
          </p>
          <AccountManager />
        </section>

        {/* ── Theme ────────────────────────────────────────────────────────── */}
        <section className="settings__section">
          <h2 className="settings__section-title">Theme</h2>
          <div className="settings__theme">
            <button
              type="button"
              className={`settings__theme-btn${!darkMode ? ' settings__theme-btn--on' : ''}`}
              onClick={() => setDarkMode(false)}
            >
              ☀ Light
            </button>
            <button
              type="button"
              className={`settings__theme-btn${darkMode ? ' settings__theme-btn--on' : ''}`}
              onClick={() => setDarkMode(true)}
            >
              ☾ Dark
            </button>
          </div>
        </section>

        {/* ── Change password (password accounts only) ─────────────────────── */}
        {!isGoogleAccount && (
          <section className="settings__section">
            <h2 className="settings__section-title">Change password</h2>
            <form onSubmit={(e) => void handleChangePassword(e)} className="settings__form">
              <input
                className="settings__input"
                type="password"
                placeholder="Current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <input
                className="settings__input"
                type="password"
                placeholder="New password (8+ chars, incl. a digit)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              <input
                className="settings__input"
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              {pwError && <p className="settings__error">{pwError}</p>}
              {pwNotice && <p className="settings__notice">{pwNotice}</p>}
              <button type="submit" className="settings__btn" disabled={pwLoading}>
                {pwLoading ? 'Saving...' : 'Update password'}
              </button>
            </form>
          </section>
        )}

        {/* ── Danger zone ──────────────────────────────────────────────────── */}
        <section className="settings__section settings__section--danger">
          <h2 className="settings__section-title">Delete account</h2>
          <p className="settings__danger-text">
            This permanently deletes your account and all associated data. This cannot be undone.
          </p>

          {!showDeleteConfirm ? (
            <button
              type="button"
              className="settings__btn settings__btn--danger"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete my account
            </button>
          ) : (
            <div className="settings__form">
              {!isGoogleAccount && (
                <input
                  className="settings__input"
                  type="password"
                  placeholder="Enter your password to confirm"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  autoComplete="current-password"
                />
              )}
              {deleteError && <p className="settings__error">{deleteError}</p>}
              <div className="settings__danger-actions">
                <button
                  type="button"
                  className="settings__btn"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="settings__btn settings__btn--danger"
                  disabled={deleteLoading}
                  onClick={() => void handleDelete()}
                >
                  {deleteLoading ? 'Deleting...' : 'Permanently delete'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default Settings;
