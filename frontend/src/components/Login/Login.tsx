/** Entry screen — log in, create an account, or continue as a guest. */

import { useState } from 'react';
import type { JSX } from 'react';
import { identifyUser, loginUser, registerUser } from '../../api/client';
import useAuth from '../../hooks/useAuth';
import useSession from '../../hooks/useSession';
import chesscomLogo from '../../assets/chesscom_logo.png';
import lichessLogo from '../../assets/Lichess_logo.png';
import './Login.css';

type Platform = 'chesscom' | 'lichess';
type Mode = 'login' | 'register' | 'guest';

const TRYOUT_USERNAMES: Record<Platform, string[]> = {
  chesscom: ['MagnusCarlsen', 'Hikaru', 'GothamChess'],
  lichess: ['SindarovGM'],
};

function Login(): JSX.Element {
  const loginAuth = useAuth((s) => s.login);
  const setScreen = useSession((s) => s.reset);
  const [mode, setMode] = useState<Mode>('login');
  const [platform, setPlatform] = useState<Platform>('chesscom');
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [platformUsername, setPlatformUsername] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const platformPlaceholder = platform === 'chesscom'
    ? 'Enter Chess.com username...'
    : 'Enter Lichess username...';

  // Reset transient form state when switching between modes.
  function switchMode(next: Mode): void {
    setMode(next);
    setError('');
    setPassword('');
    setPlatformUsername('');

    if (next !== 'guest') {
      setUsername('');
    }
  }

  function handlePlatformSelect(p: Platform): void {
    setPlatform(p);
    setUsername('');
    setPlatformUsername('');
    setError('');
  }

  // ── Guest (passwordless) path ──────────────────────────────────────────────
  async function submitGuest(name: string): Promise<void> {
    if (!name.trim()) {
      setError('Username is required.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await identifyUser(name.trim(), platform);
      loginAuth(name.trim(), res.token ?? '', res.is_admin ?? false, platform, res.avatar);
      setScreen();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleTryout(name: string): Promise<void> {
    setUsername(name);
    await submitGuest(name);
  }

  // ── Log in ─────────────────────────────────────────────────────────────────
  async function submitLogin(): Promise<void> {
    if (!username.trim() || !password) {
      setError('Username and password are required.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await loginUser(username.trim(), password);
      loginAuth(username.trim(), res.token ?? '', res.is_admin ?? false, platform, res.avatar, {
        chesscomUsername: res.chesscom_username ?? undefined,
        lichessUsername: res.lichess_username ?? undefined,
      });
      setScreen();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // ── Create account ───────────────────────────────────────────────────────────
  async function submitRegister(): Promise<void> {
    if (!username.trim() || !password) {
      setError('Choose a username and password.');
      return;
    }

    if (!platformUsername.trim()) {
      setError(`Link your ${platform === 'lichess' ? 'Lichess' : 'Chess.com'} username.`);
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await registerUser(username.trim(), password, platform, platformUsername.trim());
      loginAuth(username.trim(), res.token ?? '', res.is_admin ?? false, platform, res.avatar, {
        chesscomUsername: res.chesscom_username ?? undefined,
        lichessUsername: res.lichess_username ?? undefined,
      });
      setScreen();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();

    if (mode === 'guest') {
      void submitGuest(username);
      return;
    }

    if (mode === 'login') {
      void submitLogin();
      return;
    }

    void submitRegister();
  }

  // ── Platform selector (shared by guest + register) ──────────────────────────
  function renderPlatforms(): JSX.Element {
    return (
      <div className="login__platforms">
        <button
          type="button"
          className={`login__platform-btn${platform === 'chesscom' ? ' login__platform-btn--active' : ''}`}
          onClick={() => handlePlatformSelect('chesscom')}
        >
          <img src={chesscomLogo} alt="Chess.com" className="login__platform-logo" />
          <span className="login__platform-label">Chess.com</span>
        </button>
        <button
          type="button"
          className={`login__platform-btn${platform === 'lichess' ? ' login__platform-btn--active' : ''}`}
          onClick={() => handlePlatformSelect('lichess')}
        >
          <img src={lichessLogo} alt="Lichess" className="login__platform-logo" />
          <span className="login__platform-label">Lichess</span>
        </button>
      </div>
    );
  }

  const title = mode === 'login'
    ? 'Log in'
    : mode === 'register'
      ? 'Create your account'
      : 'Look up a player';

  const submitLabel = mode === 'register' ? 'Create account' : mode === 'guest' ? 'Continue' : 'Log in';

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
        <h2 className="login__title">{title}</h2>

        {/* Platform selector — needed for guest lookup and account linking. */}
        {(mode === 'guest' || mode === 'register') && renderPlatforms()}

        {/* Try-out quick select — guest only. */}
        {mode === 'guest' && (
          <div className="login__tryout">
            <span className="login__tryout-label">Try with</span>
            <div className="login__tryout-chips">
              {TRYOUT_USERNAMES[platform].map((name) => (
                <button
                  key={`tryout-${name}`}
                  type="button"
                  className="login__tryout-chip"
                  disabled={loading}
                  onClick={() => handleTryout(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Account username — login + register. */}
          {(mode === 'login' || mode === 'register') && (
            <div className="login__field">
              <label className="login__label" htmlFor="login-account">Account username</label>
              <input
                id="login-account"
                className={`login__input${error ? ' login__input--error' : ''}`}
                type="text"
                placeholder="Choose a username..."
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>
          )}

          {/* Password — login + register. */}
          {(mode === 'login' || mode === 'register') && (
            <div className="login__field">
              <label className="login__label" htmlFor="login-password">Password</label>
              <input
                id="login-password"
                className={`login__input${error ? ' login__input--error' : ''}`}
                type="password"
                placeholder={mode === 'register' ? 'At least 5 characters...' : 'Enter password...'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                required
              />
            </div>
          )}

          {/* Linked platform handle — register. */}
          {mode === 'register' && (
            <div className="login__field">
              <label className="login__label" htmlFor="login-platform-username">
                {platform === 'lichess' ? 'Lichess' : 'Chess.com'} username
              </label>
              <input
                id="login-platform-username"
                className={`login__input${error ? ' login__input--error' : ''}`}
                type="text"
                placeholder={platformPlaceholder}
                value={platformUsername}
                onChange={(e) => setPlatformUsername(e.target.value)}
                required
              />
            </div>
          )}

          {/* Username — guest. */}
          {mode === 'guest' && (
            <div className="login__field">
              <label className="login__label" htmlFor="login-username">Username</label>
              <input
                id="login-username"
                className={`login__input${error ? ' login__input--error' : ''}`}
                type="text"
                placeholder={platformPlaceholder}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>
          )}

          {error && <p className="login__error">{error}</p>}

          <button className="login__btn" type="submit" disabled={loading}>
            {loading ? 'Please wait...' : submitLabel}
          </button>
        </form>

        {/* Mode toggles. */}
        {mode === 'login' && (
          <p className="login__toggle">
            Need an account?{' '}
            <button type="button" className="login__toggle-link" onClick={() => switchMode('register')}>
              Create one
            </button>
          </p>
        )}
        {mode === 'register' && (
          <p className="login__toggle">
            Already have an account?{' '}
            <button type="button" className="login__toggle-link" onClick={() => switchMode('login')}>
              Log in
            </button>
          </p>
        )}
        {mode === 'guest' && (
          <p className="login__toggle">
            Want to save your progress?{' '}
            <button type="button" className="login__toggle-link" onClick={() => switchMode('login')}>
              Log in or sign up
            </button>
          </p>
        )}

        {/* Guest entry point — visible from the account modes. */}
        {mode !== 'guest' && (
          <>
            <div className="login__divider">or</div>
            <button type="button" className="login__guest-btn" onClick={() => switchMode('guest')}>
              Continue as guest — look up any player
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default Login;
