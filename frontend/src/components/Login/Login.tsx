/** Username selection screen — no password required. */

import { useState, useRef } from 'react';
import type { JSX } from 'react';
import { identifyUser } from '../../api/client';
import useAuth from '../../hooks/useAuth';
import useSession from '../../hooks/useSession';
import chesscomLogo from '../../assets/chesscom_logo.png';
import lichessLogo from '../../assets/Lichess_logo.png';
import './Login.css';

type Platform = 'chesscom' | 'lichess';

const TRYOUT_USERNAMES: Record<Platform, string[]> = {
  chesscom: ['MagnusCarlsen', 'Hikaru', 'GothamChess'],
  lichess: ['SindarovGM'],
};

function Login(): JSX.Element {
  const loginAuth = useAuth((s) => s.login);
  const setScreen = useSession((s) => s.reset);

  const [platform, setPlatform] = useState<Platform>('chesscom');
  const [username, setUsername] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const formRef = useRef<HTMLFormElement>(null);

  const placeholder = platform === 'chesscom'
    ? 'Enter Chess.com username...'
    : 'Enter Lichess username...';

  async function submitUsername(name: string): Promise<void> {
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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    await submitUsername(username);
  }

  function handlePlatformSelect(p: Platform): void {
    setPlatform(p);
    setUsername('');
    setError('');
  }

  async function handleTryout(name: string): Promise<void> {
    setUsername(name);
    await submitUsername(name);
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
        <h2 className="login__title">Choose your platform</h2>

        {/* Platform selector */}
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

        {/* Try-out quick select */}
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

        {/* Username form */}
        <form ref={formRef} onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="login__field">
            <label className="login__label" htmlFor="login-username">Username</label>
            <input
              id="login-username"
              className={`login__input${error ? ' login__input--error' : ''}`}
              type="text"
              placeholder={placeholder}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          {error && <p className="login__error">{error}</p>}

          <button className="login__btn" type="submit" disabled={loading}>
            {loading ? 'Checking...' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Login;
