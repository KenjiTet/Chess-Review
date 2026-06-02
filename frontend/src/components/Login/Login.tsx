/** Login / register / guest entry screen. */

import { useState } from 'react';
import type { JSX } from 'react';
import { loginUser, registerUser } from '../../api/client';
import useAuth from '../../hooks/useAuth';
import useSession from '../../hooks/useSession';
import './Login.css';

type Mode = 'login' | 'register';

function Login(): JSX.Element {
  const loginAuth = useAuth((s) => s.login);
  const loginAsGuest = useAuth((s) => s.loginAsGuest);
  const setScreen = useSession((s) => s.reset);

  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirm, setConfirm] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  function clearFields(): void {
    setUsername('');
    setPassword('');
    setConfirm('');
    setError('');
  }

  function handleToggleMode(): void {
    clearFields();
    setMode((m) => (m === 'login' ? 'register' : 'login'));
  }

  function validate(): string | undefined {
    if (!username.trim()) {
      return 'Username is required.';
    }

    if (password.length < 5) {
      return 'Password must be at least 5 characters.';
    }

    if (mode === 'register' && password !== confirm) {
      return 'Passwords do not match.';
    }

    return undefined;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const validationError = validate();

    if (validationError) {
      setError(validationError);
      return;
    }

    setError('');
    setLoading(true);

    try {
      if (mode === 'login') {
        const res = await loginUser(username.trim(), password);
        loginAuth(username.trim(), res.token ?? '', res.is_admin ?? false);
      } else {
        await registerUser(username.trim(), password);
        // After registration the user must log in — switch to login mode.
        clearFields();
        setMode('login');
        setError('');
        setLoading(false);
        return;
      }

      setScreen();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleGuest(): void {
    loginAsGuest();
    setScreen();
  }

  return (
    <div className="login">
      <div className="login__hero">
        <span className="login__hero-icon">♚</span>
        <h1 className="login__hero-title">
          Chess <span className="login__gold">Blunder</span> Trainer
        </h1>
        <p className="login__hero-sub">Review your blunders like a daily puzzle</p>
      </div>

      <div className="login__card">
        <h2 className="login__title">
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </h2>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="login__field">
            <label className="login__label" htmlFor="login-username">Username</label>
            <input
              id="login-username"
              className={`login__input${error ? ' login__input--error' : ''}`}
              type="text"
              placeholder="Chess.com username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div className="login__field">
            <label className="login__label" htmlFor="login-password">Password</label>
            <input
              id="login-password"
              className={`login__input${error ? ' login__input--error' : ''}`}
              type="password"
              placeholder="Min. 5 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </div>

          {mode === 'register' && (
            <div className="login__field">
              <label className="login__label" htmlFor="login-confirm">Confirm Password</label>
              <input
                id="login-confirm"
                className={`login__input${error ? ' login__input--error' : ''}`}
                type="password"
                placeholder="Repeat password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          )}

          {error && <p className="login__error">{error}</p>}

          <button className="login__btn" type="submit" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="login__divider">or</div>

        <button className="login__guest-btn" type="button" onClick={handleGuest}>
          Continue as Guest
        </button>

        <p className="login__toggle">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button className="login__toggle-link" type="button" onClick={handleToggleMode}>
            {mode === 'login' ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}

export default Login;
