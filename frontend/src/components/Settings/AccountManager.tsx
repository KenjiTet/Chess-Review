/**
 * Interactive chess-accounts manager for the Settings page.
 *
 * Replaces the old "list + separate modal" split with a single inline surface:
 * one card per platform that shows the linked handle, lets you pick which
 * account drives the displayed stats (recent games, win rate, avg blunders,
 * ratings), and lets you link / change a handle inline — no modal hop.
 */

import { useState } from 'react';
import type { JSX } from 'react';
import { linkAccount } from '../../api/client';
import useAuth from '../../hooks/useAuth';
import chesscomLogo from '../../assets/chesscom_logo.png';
import lichessLogo from '../../assets/Lichess_logo.webp';
import './AccountManager.css';

type Platform = 'chesscom' | 'lichess';

interface PlatformMeta {
  key: Platform;
  label: string;
  logo: string;
  placeholder: string;
}

// Static per-platform display metadata, iterated to render one card each.
const PLATFORMS: readonly PlatformMeta[] = [
  { key: 'chesscom', label: 'Chess.com', logo: chesscomLogo, placeholder: 'Chess.com username…' },
  { key: 'lichess', label: 'Lichess', logo: lichessLogo, placeholder: 'Lichess username…' },
];

function AccountManager(): JSX.Element {
  const chesscomUsername = useAuth((s) => s.chesscomUsername);
  const lichessUsername = useAuth((s) => s.lichessUsername);
  const activePlatform = useAuth((s) => s.platform);
  const setActivePlatform = useAuth((s) => s.setActivePlatform);
  const setLinks = useAuth((s) => s.setLinks);

  // Which card's inline link/change form is open (undefined = none).
  const [editing, setEditing] = useState<Platform | undefined>(undefined);
  const [handle, setHandle] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  // Resolve the currently linked handle for a platform.
  function handleFor(platform: Platform): string | undefined {
    if (platform === 'lichess') {
      return lichessUsername ?? undefined;
    }

    return chesscomUsername ?? undefined;
  }

  // Only linked platforms can be "active". Fall back to chesscom when unset.
  const resolvedActive: Platform = activePlatform === 'lichess' ? 'lichess' : 'chesscom';

  function openEditor(platform: Platform): void {
    setEditing(platform);
    setHandle(handleFor(platform) ?? '');
    setError('');
  }

  function closeEditor(): void {
    setEditing(undefined);
    setHandle('');
    setError('');
  }

  function selectActive(platform: Platform): void {
    // Selecting only makes sense for a linked account.
    if (!handleFor(platform)) {
      return;
    }

    setActivePlatform(platform);
  }

  async function handleSave(platform: Platform): Promise<void> {
    if (!handle.trim()) {
      setError('Username is required.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const wasLinked = handleFor(platform) !== undefined;
      const res = await linkAccount(platform, handle.trim());

      setLinks({
        chesscomUsername: res.chesscom_username ?? undefined,
        lichessUsername: res.lichess_username ?? undefined,
      });

      // First time linking this platform → make it the displayed account so the
      // freshly linked handle's stats show up straight away.
      if (!wasLinked) {
        setActivePlatform(platform);
      }

      closeEditor();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="acctmgr">
      {PLATFORMS.map((meta) => {
        const linked = handleFor(meta.key);
        const isActive = linked !== undefined && resolvedActive === meta.key;
        const isEditing = editing === meta.key;

        return (
          <div
            key={`acctcard-${meta.key}`}
            className={`acctmgr__card${isActive ? ' acctmgr__card--active' : ''}${linked ? ' acctmgr__card--linked' : ''}`}
            role={linked && !isEditing ? 'button' : undefined}
            tabIndex={linked && !isEditing ? 0 : undefined}
            onClick={() => {
              if (linked && !isEditing) {
                selectActive(meta.key);
              }
            }}
            onKeyDown={(e) => {
              if (linked && !isEditing && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                selectActive(meta.key);
              }
            }}
          >
            {/* ── Header: logo + platform + active radio ── */}
            <div className="acctmgr__head">
              <img className="acctmgr__logo" src={meta.logo} alt="" />
              <span className="acctmgr__platform">{meta.label}</span>

              {isActive && <span className="acctmgr__badge">Showing</span>}

              {linked && !isActive && (
                <span className="acctmgr__radio" aria-hidden="true" />
              )}
            </div>

            {/* ── Body: handle / edit form ── */}
            {isEditing ? (
              <form
                className="acctmgr__form"
                onClick={(e) => e.stopPropagation()}
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSave(meta.key);
                }}
              >
                <input
                  className={`acctmgr__input${error ? ' acctmgr__input--error' : ''}`}
                  type="text"
                  placeholder={meta.placeholder}
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  autoFocus
                />
                {error && <p className="acctmgr__error">{error}</p>}
                <div className="acctmgr__form-actions">
                  <button type="button" className="acctmgr__btn" onClick={closeEditor}>
                    Cancel
                  </button>
                  <button type="submit" className="acctmgr__btn acctmgr__btn--primary" disabled={loading}>
                    {loading ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="acctmgr__body">
                {linked ? (
                  <span className="acctmgr__handle">{linked}</span>
                ) : (
                  <span className="acctmgr__unlinked">Not linked</span>
                )}

                <button
                  type="button"
                  className="acctmgr__link-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditor(meta.key);
                  }}
                >
                  {linked ? 'Change' : 'Link'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default AccountManager;
