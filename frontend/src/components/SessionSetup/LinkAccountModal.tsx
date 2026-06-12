/** Modal for linking (or changing) a Chess.com / Lichess handle on the current account. */

import { useState } from 'react';
import type { JSX } from 'react';
import { linkAccount } from '../../api/client';
import useAuth from '../../hooks/useAuth';
import './LinkAccountModal.css';

type Platform = 'chesscom' | 'lichess';

interface LinkAccountModalProps {
  onClose: () => void;
}

function LinkAccountModal({ onClose }: LinkAccountModalProps): JSX.Element {
  const chesscomUsername = useAuth((s) => s.chesscomUsername);
  const lichessUsername = useAuth((s) => s.lichessUsername);
  const setLinks = useAuth((s) => s.setLinks);

  // Default to whichever platform is not yet linked, so the common case is one tap.
  const initialPlatform: Platform = chesscomUsername ? 'lichess' : 'chesscom';

  const [platform, setPlatform] = useState<Platform>(initialPlatform);
  const [handle, setHandle] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();

    if (!handle.trim()) {
      setError('Username is required.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await linkAccount(platform, handle.trim());
      setLinks({
        chesscomUsername: res.chesscom_username ?? undefined,
        lichessUsername: res.lichess_username ?? undefined,
      });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="link-modal__scrim" onClick={onClose}>
      <div className="link-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="link-modal__title">Link a chess account</h3>

        <div className="link-modal__current">
          <span>Chess.com: <strong>{chesscomUsername ?? '—'}</strong></span>
          <span>Lichess: <strong>{lichessUsername ?? '—'}</strong></span>
        </div>

        <form onSubmit={handleSubmit} className="link-modal__form">
          <div className="link-modal__seg">
            <button
              type="button"
              className={`link-modal__seg-btn${platform === 'chesscom' ? ' link-modal__seg-btn--on' : ''}`}
              onClick={() => setPlatform('chesscom')}
            >
              Chess.com
            </button>
            <button
              type="button"
              className={`link-modal__seg-btn${platform === 'lichess' ? ' link-modal__seg-btn--on' : ''}`}
              onClick={() => setPlatform('lichess')}
            >
              Lichess
            </button>
          </div>

          <input
            className={`link-modal__input${error ? ' link-modal__input--error' : ''}`}
            type="text"
            placeholder={platform === 'lichess' ? 'Lichess username...' : 'Chess.com username...'}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            autoFocus
            required
          />

          {error && <p className="link-modal__error">{error}</p>}

          <div className="link-modal__actions">
            <button type="button" className="link-modal__cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="link-modal__save" disabled={loading}>
              {loading ? 'Linking...' : 'Link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default LinkAccountModal;
