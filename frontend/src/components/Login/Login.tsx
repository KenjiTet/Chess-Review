/** Entry screen — log in with email, create an account, reset a password, or continue as a guest. */

import { useState } from 'react';
import type { JSX } from 'react';
import { forgotPassword, googleLogin, identifyUser, loginUser, registerUser } from '../../api/client';
import type { AuthResponse } from '../../api/client';
import useAuth from '../../hooks/useAuth';
import useSession from '../../hooks/useSession';
import chesscomLogo from '../../assets/chesscom_logo.png';
import lichessLogo from '../../assets/Lichess_logo.webp';
import GoogleButton from './GoogleButton';
import './Login.css';

type Platform = 'chesscom' | 'lichess';
type Mode = 'login' | 'register' | 'guest' | 'forgot';

interface LoginProps {
  // When embedded in the marketing Landing page, the Landing supplies the page
  // hero (and the single <h1>), so Login suppresses its own hero to avoid a
  // duplicate heading.
  embedded?: boolean;
}

const TRYOUT_USERNAMES: Record<Platform, string[]> = {
  chesscom: ['MagnusCarlsen', 'Hikaru', 'GothamChess'],
  lichess: ['SindarovGM'],
};

/** Client-side mirror of the backend password policy (>= 8 chars, at least one digit). */
function passwordPolicyError(password: string): string | undefined {
  const hasDigit = /\d/.test(password);

  if (password.length < 8 || !hasDigit) {
    return 'Password must be at least 8 characters and include a digit.';
  }

  return undefined;
}

/** Derive which platform an account is on from the linked handles in a response. */
function platformFromLinks(res: AuthResponse): Platform {
  if (res.lichess_username && !res.chesscom_username) {
    return 'lichess';
  }

  return 'chesscom';
}

function Login(props: LoginProps): JSX.Element {
  const embedded = props.embedded ?? false;
  const loginAuth = useAuth((s) => s.login);
  const resetToSetup = useSession((s) => s.reset);
  const setScreen = useSession((s) => s.setScreen);
  const [mode, setMode] = useState<Mode>('login');
  const [platform, setPlatform] = useState<Platform>('chesscom');
  const [email, setEmail] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [platformUsername, setPlatformUsername] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const platformPlaceholder = platform === 'chesscom'
    ? 'Enter Chess.com username...'
    : 'Enter Lichess username...';

  // Reset transient form state when switching between modes.
  function switchMode(next: Mode): void {
    setMode(next);
    setError('');
    setNotice('');
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
      resetToSetup();
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
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await loginUser(email.trim(), password);
      const accountPlatform = platformFromLinks(res);
      loginAuth(res.username, res.token ?? '', res.is_admin ?? false, accountPlatform, res.avatar, {
        chesscomUsername: res.chesscom_username ?? undefined,
        lichessUsername: res.lichess_username ?? undefined,
        email: res.email ?? undefined,
        emailVerified: res.email_verified ?? false,
        authProvider: res.auth_provider ?? undefined,
      });
      resetToSetup();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // ── Create account ───────────────────────────────────────────────────────────
  async function submitRegister(): Promise<void> {
    if (!email.trim() || !password) {
      setError('Enter an email and password.');
      return;
    }

    const policyError = passwordPolicyError(password);

    if (policyError) {
      setError(policyError);
      return;
    }

    if (!platformUsername.trim()) {
      setError(`Link your ${platform === 'lichess' ? 'Lichess' : 'Chess.com'} username.`);
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await registerUser(email.trim(), password, platform, platformUsername.trim());
      loginAuth(res.username, res.token ?? '', res.is_admin ?? false, platform, res.avatar, {
        chesscomUsername: res.chesscom_username ?? undefined,
        lichessUsername: res.lichess_username ?? undefined,
        email: res.email ?? undefined,
        emailVerified: res.email_verified ?? false,
        authProvider: res.auth_provider ?? undefined,
      });
      resetToSetup();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // ── Forgot password ──────────────────────────────────────────────────────────
  async function submitForgot(): Promise<void> {
    if (!email.trim()) {
      setError('Enter your email.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await forgotPassword(email.trim());
      setNotice(res.message);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // ── Google sign-in ───────────────────────────────────────────────────────────
  async function handleGoogleCredential(idToken: string): Promise<void> {
    setError('');
    setLoading(true);

    try {
      const res = await googleLogin(idToken);
      const accountPlatform = platformFromLinks(res);
      loginAuth(res.username, res.token ?? '', res.is_admin ?? false, accountPlatform, res.avatar, {
        chesscomUsername: res.chesscom_username ?? undefined,
        lichessUsername: res.lichess_username ?? undefined,
        email: res.email ?? undefined,
        emailVerified: res.email_verified ?? false,
        authProvider: res.auth_provider ?? undefined,
      });

      // Brand-new Google accounts have no chess handle yet — send them to Settings
      // to link one before training (a session needs a real platform handle).
      if (res.needs_link) {
        setScreen('settings');
        return;
      }

      resetToSetup();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
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

    if (mode === 'forgot') {
      void submitForgot();
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
      : mode === 'forgot'
        ? 'Reset your password'
        : 'Look up a player';

  const submitLabel = mode === 'register'
    ? 'Create account'
    : mode === 'guest'
      ? 'Continue'
      : mode === 'forgot'
        ? 'Send reset link'
        : 'Log in';

  // Standalone hero — only shown when Login renders on its own (not embedded in
  // the Landing page, which owns the page's single <h1>).
  function renderHero(): JSX.Element | undefined {
    if (embedded) {
      return undefined;
    }

    return (
      <div className="login__hero">
        <span className="login__hero-icon">♚</span>
        <h1 className="login__hero-title">
          Chess <span className="login__gold">Blunder</span> Trainer
        </h1>
        <p className="login__hero-sub">Review your blunders like a daily puzzle</p>
      </div>
    );
  }

  return (
    <div className={`login${embedded ? ' login--embedded' : ''}`}>
      {renderHero()}

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
          {/* Email — login (email or legacy username) + register + forgot. */}
          {(mode === 'login' || mode === 'register' || mode === 'forgot') && (
            <div className="login__field">
              <label className="login__label" htmlFor="login-email">
                {mode === 'login' ? 'Email or username' : 'Email'}
              </label>
              <input
                id="login-email"
                className={`login__input${error ? ' login__input--error' : ''}`}
                // Login accepts legacy usernames too, so it can't be a strict email input.
                type={mode === 'login' ? 'text' : 'email'}
                placeholder={mode === 'login' ? 'Email or username...' : 'you@example.com'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete={mode === 'login' ? 'username' : 'email'}
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
                placeholder={mode === 'register' ? 'At least 8 characters, incl. a digit...' : 'Enter password...'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                required
              />
            </div>
          )}

          {/* Forgot-password link — login only. */}
          {mode === 'login' && (
            <button type="button" className="login__forgot-link" onClick={() => switchMode('forgot')}>
              Forgot password?
            </button>
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
          {notice && <p className="login__notice">{notice}</p>}

          <button className="login__btn" type="submit" disabled={loading}>
            {loading ? 'Please wait...' : submitLabel}
          </button>
        </form>

        {/* Google sign-in — hidden when no client id is configured. Not shown in
            the forgot-password flow. */}
        {mode !== 'forgot' && mode !== 'guest' && (
          <>
            <div className="login__divider">or</div>
            <GoogleButton onCredential={(idToken) => void handleGoogleCredential(idToken)} />
          </>
        )}

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
        {mode === 'forgot' && (
          <p className="login__toggle">
            Remembered it?{' '}
            <button type="button" className="login__toggle-link" onClick={() => switchMode('login')}>
              Back to log in
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
        {(mode === 'login' || mode === 'register') && (
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
