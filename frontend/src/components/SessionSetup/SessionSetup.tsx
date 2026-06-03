/** Setup screen — player identity, time control, game history, favorites. */

import { useState, useRef } from 'react';
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
import ThresholdPicker from '../ThresholdPicker/ThresholdPicker';
import chesscomLogo from '../../assets/chesscom_logo.png';
import lichessLogo from '../../assets/Lichess_logo.png';
import './SessionSetup.css';

const TIME_CLASSES = ['all', 'rapid', 'blitz', 'bullet', 'daily'] as const;
type TimeClass = (typeof TIME_CLASSES)[number];

const TIME_CLASS_STORAGE_KEY = 'recall_time_class';

function getSavedTimeClass(): TimeClass {
  // Always default to "all" — do not restore a previously saved selection.
  return 'all';
}

// ── Custom time-class select with icons ────────────────────────────────────

interface TimeClassSelectProps {
  value: TimeClass;
  onChange: (v: TimeClass) => void;
}

function TimeClassSelect({ value, onChange }: TimeClassSelectProps): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

// ── Player identity card ───────────────────────────────────────────────────

interface PlayerCardProps {
  username: string;
  avatar: string | undefined;
  platform: string | undefined;
}

function PlayerCard({ username, avatar, platform }: PlayerCardProps): JSX.Element {
  const [imgFailed, setImgFailed] = useState<boolean>(false);

  const fallbackSrc = platform === 'lichess' ? lichessLogo : chesscomLogo;
  const showAvatar = avatar && !imgFailed;

  return (
    <div className="setup__player-card">
      <div className="setup__player-avatar">
        {showAvatar ? (
          <img
            src={avatar}
            alt={username}
            className="setup__player-avatar-img"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <img
            src={fallbackSrc}
            alt={platform ?? 'platform'}
            className="setup__player-avatar-img setup__player-avatar-img--logo"
          />
        )}
      </div>
      <span className="setup__player-name">{username}</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

function SessionSetup(): JSX.Element {
  const buildSession = useSession((s) => s.buildSession);
  const loadFavoritePosition = useSession((s) => s.loadFavoritePosition);

  const nGames = useSettings((s) => s.nGames);
  const threshold = useSettings((s) => s.threshold);
  const setThreshold = useSettings((s) => s.setThreshold);

  const authUsername = useAuth((s) => s.username);
  const isGuest = useAuth((s) => s.isGuest);
  const avatar = useAuth((s) => s.avatar);
  const platform = useAuth((s) => s.platform);
  const logout = useAuth((s) => s.logout);
  const isReviewed = useReviewed((s) => s.isReviewed);

  const [showFavorites, setShowFavorites] = useState<boolean>(false);
  const [timeClass, setTimeClass] = useState<TimeClass>(getSavedTimeClass);

  const username = authUsername ?? '';

  function handleTimeClassChange(tc: TimeClass): void {
    setTimeClass(tc);
    localStorage.setItem(TIME_CLASS_STORAGE_KEY, tc);
  }

  const gamesRef = useRef<GameHistoryEntry[]>([]);

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

    return gamesRef.current[0]?.url;
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();

    const gameUrl = findLastNonReviewedUrl();
    const trainTimeClass = timeClass === 'all' ? 'rapid' : timeClass;

    buildSession({
      username,
      time_class: trainTimeClass,
      n_games: nGames,
      threshold,
      game_url: gameUrl,
      platform: platform ?? 'chesscom',
    });
  };

  function handleTrainGame(gameUrl: string): void {
    buildSession({
      username,
      time_class: timeClass === 'all' ? 'rapid' : timeClass,
      n_games: 1,
      threshold,
      game_url: gameUrl,
      platform: platform ?? 'chesscom',
    });
  }

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

      {/* User identity badge — fixed bottom-left */}
      <div className="setup__user-row">
        {username && (
          <span className="setup__user-name">{username}</span>
        )}
        <button className="setup__logout-btn" type="button" onClick={handleLogout}>
          Log out
        </button>
      </div>

      <form className="setup__card" onSubmit={handleSubmit}>
        {/* ── Controls row: player + time + favorites toggle ── */}
        <div className="setup__controls-row">
          {/* Player identity — no box, inline with controls */}
          <div className="setup__field setup__field--player">
            <label className="setup__label">Player</label>
            <PlayerCard username={username} avatar={avatar} platform={platform} />
          </div>

          <div className="setup__field setup__field--time">
            <label className="setup__label" htmlFor="setup-timeclass">Time Control</label>
            <TimeClassSelect
              value={timeClass}
              onChange={handleTimeClassChange}
            />
          </div>

          <div className="setup__field setup__field--threshold">
            <label className="setup__label">Sensitivity</label>
            <ThresholdPicker value={threshold} onChange={setThreshold} />
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
            username && (
              <>
                <div className="setup__section-title">Recent Games</div>
                <GameHistory
                  username={username}
                  timeClass={timeClass}
                  isGuest={isGuest}
                  platform={platform ?? 'chesscom'}
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
