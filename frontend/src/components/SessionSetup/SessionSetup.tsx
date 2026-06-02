/** Setup screen — username, time control, game history, favorites. */

import { useState, useRef, useEffect } from 'react';
import type { JSX } from 'react';
import useSession from '../../hooks/useSession';
import useSettings from '../../hooks/useSettings';
import useAuth from '../../hooks/useAuth';
import useReviewed from '../../hooks/useReviewed';
import Favorites from '../Favorites/Favorites';
import GameHistory from '../GameHistory/GameHistory';
import type { GameHistoryEntry } from '../../api/client.ts';
import type { FavoritePosition } from '../../hooks/useFavorites';
import { TimeClassIcon } from '../TimeClassIcons';
import './SessionSetup.css';

const TIME_CLASSES = ['all', 'rapid', 'blitz', 'bullet', 'daily'] as const;
type TimeClass = (typeof TIME_CLASSES)[number];

const STORAGE_KEY = 'recall_recent_usernames';
const TIME_CLASS_STORAGE_KEY = 'recall_time_class';

function getSavedTimeClass(): TimeClass {
  try {
    const stored = localStorage.getItem(TIME_CLASS_STORAGE_KEY);

    if (stored && (TIME_CLASSES as readonly string[]).includes(stored)) {
      return stored as TimeClass;
    }

    return 'rapid';
  } catch {
    return 'rapid';
  }
}

function getRecentUsernames(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      return [];
    }

    return JSON.parse(stored) as string[];
  } catch {
    return [];
  }
}

function addRecentUsername(name: string): void {
  const trimmed = name.trim();

  if (!trimmed) {
    return;
  }

  const recent = getRecentUsernames().filter((n) => n !== trimmed);
  const updated = [trimmed, ...recent].slice(0, 3);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

function getInitialUsername(authUsername: string | undefined): string {
  if (authUsername) {
    return authUsername;
  }

  const recents = getRecentUsernames();
  return recents[0] ?? '';
}

// ── Custom time-class select with icons ────────────────────────────────────

interface TimeClassSelectProps {
  value: TimeClass;
  onChange: (v: TimeClass) => void;
}

function TimeClassSelect({ value, onChange }: TimeClassSelectProps): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent): void {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  function handleToggle(): void {
    setOpen((prev) => !prev);
  }

  function handleSelect(tc: TimeClass): void {
    onChange(tc);
    setOpen(false);
  }

  const label = value === 'all' ? 'All' : value.charAt(0).toUpperCase() + value.slice(1);

  return (
    <div ref={dropdownRef} className="tc-select">
      <button
        type="button"
        className="tc-select__trigger"
        onClick={handleToggle}
      >
        {value !== 'all' && <TimeClassIcon tc={value} size={15} />}
        <span className="tc-select__label">{label}</span>
        <svg className={`tc-select__chevron${open ? ' tc-select__chevron--open' : ''}`} viewBox="0 0 10 6" fill="currentColor">
          <path d="M0 0l5 6 5-6z" />
        </svg>
      </button>

      {open && (
        <ul className="tc-select__menu">
          {TIME_CLASSES.map((tc) => (
            <li
              key={`tc-opt-${tc}`}
              className={`tc-select__option${tc === value ? ' tc-select__option--active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(tc);
              }}
            >
              {tc !== 'all' && <TimeClassIcon tc={tc} size={14} />}
              <span>{tc === 'all' ? 'All' : tc.charAt(0).toUpperCase() + tc.slice(1)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

function SessionSetup(): JSX.Element {
  const buildSession = useSession((s) => s.buildSession);
  const loadFavoritePosition = useSession((s) => s.loadFavoritePosition);

  const nGames = useSettings((s) => s.nGames);
  const threshold = useSettings((s) => s.threshold);

  const authUsername = useAuth((s) => s.username);
  const isGuest = useAuth((s) => s.isGuest);
  const logout = useAuth((s) => s.logout);
  const isReviewed = useReviewed((s) => s.isReviewed);

  const [showFavorites, setShowFavorites] = useState<boolean>(false);
  const [username, setUsername] = useState<string>(() => getInitialUsername(authUsername));
  const [timeClass, setTimeClass] = useState<TimeClass>(getSavedTimeClass);

  function handleTimeClassChange(tc: TimeClass): void {
    setTimeClass(tc);
    localStorage.setItem(TIME_CLASS_STORAGE_KEY, tc);
  }
  const [showDropdown, setShowDropdown] = useState<boolean>(false);
  const [recentUsernames, setRecentUsernames] = useState<string[]>(getRecentUsernames);

  // Pre-populate with the auth username (or most recent) so history loads immediately.
  const [historyUsername, setHistoryUsername] = useState<string>(() => getInitialUsername(authUsername));
  const gamesRef = useRef<GameHistoryEntry[]>([]);

  // The display name shown in the user badge (logged-in username or "Guest").
  const displayName = isGuest ? 'Guest' : (authUsername ?? '');

  function handleOpenFavorite(fav: FavoritePosition): void {
    loadFavoritePosition({
      fen: fav.fen,
      color: fav.color,
      moveSan: fav.moveSan,
      cpLoss: fav.cpLoss,
      classification: fav.classification,
      moveNumber: fav.moveNumber,
    });
  }

  function handleGamesLoaded(games: GameHistoryEntry[]): void {
    gamesRef.current = games;
  }

  function findLastNonReviewedUrl(): string | undefined {
    for (const game of gamesRef.current) {
      if (!isReviewed(game.url)) {
        return game.url;
      }
    }

    // Fall back to most recent game if all are reviewed.
    return gamesRef.current[0]?.url;
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    addRecentUsername(username);
    setRecentUsernames(getRecentUsernames());

    const gameUrl = findLastNonReviewedUrl();
    const trainTimeClass = timeClass === 'all' ? 'rapid' : timeClass;

    buildSession({
      username,
      time_class: trainTimeClass,
      n_games: nGames,
      threshold,
      game_url: gameUrl,
    });
  };

  function handleTrainGame(gameUrl: string): void {
    addRecentUsername(username);
    setRecentUsernames(getRecentUsernames());

    buildSession({
      username,
      time_class: timeClass === 'all' ? 'rapid' : timeClass,
      n_games: 1,
      threshold,
      game_url: gameUrl,
    });
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter') {
      return;
    }
    // Prevent form submission — only validate the username.
    e.preventDefault();
    setShowDropdown(false);
    if (username.trim()) {
      setHistoryUsername(username.trim());
    }
  };

  const handleInputFocus = (): void => {
    if (recentUsernames.length > 0) {
      setShowDropdown(true);
    }
  };

  const handleInputBlur = (): void => {
    // Delay to allow dropdown click to register before hiding.
    setTimeout(() => {
      setShowDropdown(false);

      // Trigger history fetch when user leaves the username field with a value.
      if (username.trim()) {
        setHistoryUsername(username.trim());
      }
    }, 150);
  };

  const handleSelectRecent = (name: string): void => {
    setUsername(name);
    setShowDropdown(false);
    setHistoryUsername(name.trim());
  };

  function handleLogout(): void {
    logout();
  }

  return (
    <div className="setup">
      <div className="setup__hero">
        <span className="setup__hero-icon">♚</span>
        <h1 className="setup__hero-title">
          Chess <span className="setup__gold">Blunder</span> Trainer
        </h1>
        <p className="setup__hero-sub">Review your blunders like a daily puzzle</p>
      </div>

      {/* User identity — fixed at bottom-left, takes no layout height */}
      <div className="setup__user-row">
        {displayName && (
          <span className="setup__user-name">{displayName}</span>
        )}
        <button className="setup__logout-btn" type="button" onClick={handleLogout}>
          Log out
        </button>
      </div>

      <form className="setup__card" onSubmit={handleSubmit}>
        {/* ── Controls row: player + time + favorites toggle ── */}
        <div className="setup__controls-row">
          <div className="setup__field setup__field--player">
            <label className="setup__label" htmlFor="setup-username">Player</label>
            <div className="setup__input-wrap">
              <input
                id="setup-username"
                className="setup__input"
                type="text"
                placeholder="Chess.com username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
                onKeyDown={handleInputKeyDown}
                required
                autoComplete="off"
              />
              {showDropdown && recentUsernames.length > 0 && (
                <ul className="setup__recent-list">
                  {recentUsernames.map((name, idx) => (
                    <li
                      key={`recent-${name}-${idx}`}
                      className="setup__recent-item"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectRecent(name);
                      }}
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="setup__field setup__field--time">
            <label className="setup__label" htmlFor="setup-timeclass">Time Control</label>
            <TimeClassSelect
              value={timeClass}
              onChange={handleTimeClassChange}
            />
          </div>

          {/* Favorites toggle — star icon button */}
          <div className="setup__field setup__field--fav">
            <label className="setup__label">&nbsp;</label>
            <button
              type="button"
              className={`setup__fav-btn${showFavorites ? ' setup__fav-btn--active' : ''}`}
              onClick={() => setShowFavorites((v) => !v)}
              title={showFavorites ? 'Back to recent games' : 'View saved positions'}
            >
              {showFavorites ? '★' : '☆'}
            </button>
          </div>
        </div>

        {/* ── Content panel: history or favorites ── */}
        <div className="setup__content-panel">
          {showFavorites ? (
            <>
              <div className="setup__section-title">Saved Positions</div>
              <div className="setup__favorites-wrap">
                <Favorites onOpen={handleOpenFavorite} />
              </div>
            </>
          ) : (
            historyUsername && (
              <>
                <div className="setup__section-title">Recent Games</div>
                <GameHistory
                  username={historyUsername}
                  timeClass={timeClass}
                  threshold={threshold}
                  isGuest={isGuest}
                  onTrainGame={handleTrainGame}
                  onGamesLoaded={handleGamesLoaded}
                />
              </>
            )
          )}
        </div>

        <button className="setup__submit" type="submit">
          Start Training
        </button>
      </form>
    </div>
  );
}

export default SessionSetup;
