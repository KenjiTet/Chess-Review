/** Setup screen — player identity, time control, game history, favorites. */

import { useState, useRef } from 'react';
import type { JSX } from 'react';
import useSession from '../../hooks/useSession';
import useSettings from '../../hooks/useSettings';
import useAuth from '../../hooks/useAuth';
import useReviewed from '../../hooks/useReviewed';
import Favorites from '../Favorites/Favorites';
import GameHistory from '../GameHistory/GameHistory';
import ProfileBand from './ProfileBand';
import type { GameHistoryEntry } from '../../api/client.ts';
import type { FavoritePosition } from '../../hooks/useFavorites';
import { TimeClassIcon } from '../TimeClassIcons';
import ThresholdPicker from '../ThresholdPicker/ThresholdPicker';
import chesscomLogo from '../../assets/chesscom_logo.png';
import lichessLogo from '../../assets/Lichess_logo.png';
import settingsIcon from '../../assets/settings.svg';
import './SessionSetup.css';
import './SessionSetup.mobile.css';

const TIME_CLASSES = ['all', 'rapid', 'blitz', 'bullet', 'daily'] as const;
type TimeClass = (typeof TIME_CLASSES)[number];

const TIME_CLASS_STORAGE_KEY = 'recall_time_class';

function getSavedTimeClass(): TimeClass {
  // Always default to "all" — do not restore a previously saved selection.
  return 'all';
}

// ── Profile stats derived from loaded game list ────────────────────────────

interface ProfileStats {
  winRate30d: number | undefined;
  gamesAnalysed: number;
  blundersDrilled: number;
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

// ── Tab SVG icons ──────────────────────────────────────────────────────────

function ListIconSvg(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function StarIconSvg(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface SessionSetupProps {
  isMobile?: boolean;
  isAdmin?: boolean;
  adminView?: boolean;
  onAdminToggle?: () => void;
}

function SessionSetup({ isMobile = false, isAdmin = false, adminView = false, onAdminToggle }: SessionSetupProps): JSX.Element {
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

  const darkMode = useSettings((s) => s.darkMode);
  const setDarkMode = useSettings((s) => s.setDarkMode);
  const mobileOverride = useSettings((s) => s.mobileOverride);
  const toggleMobileOverride = useSettings((s) => s.toggleMobileOverride);

  const [showFavorites, setShowFavorites] = useState<boolean>(false);
  const [timeClass, setTimeClass] = useState<TimeClass>(getSavedTimeClass);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState<boolean>(false);
  const [profileStats, setProfileStats] = useState<ProfileStats>({
    winRate30d: undefined,
    gamesAnalysed: 0,
    blundersDrilled: 0,
  });

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

    // Win rate over the last 30 days.
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const recent = games.filter((g) => now - new Date(g.date).getTime() < thirtyDaysMs);

    let winRate30d: number | undefined;

    if (recent.length > 0) {
      winRate30d = (recent.filter((g) => g.result === 'win').length / recent.length) * 100;
    }

    // Games already analysed by Stockfish.
    const gamesAnalysed = games.filter((g) => g.blunder_count !== null).length;

    // Blunders in reviewed games (sum of blunder counts, from loaded list only).
    const blundersDrilled = games
      .filter((g) => isReviewed(g.url) && g.blunder_count !== null && g.blunder_count > 0)
      .reduce((sum, g) => sum + (g.blunder_count ?? 0), 0);

    setProfileStats({ winRate30d, gamesAnalysed, blundersDrilled });
  }

  function findLastNonReviewedUrl(): string | undefined {
    for (const game of gamesRef.current) {
      if (!isReviewed(game.url)) {
        return game.url;
      }
    }

    return gamesRef.current[0]?.url;
  }

  function resolveLoadingTitle(gameUrl: string | undefined): string {
    if (!gameUrl) {
      return 'Analysing your games…';
    }

    const game = gamesRef.current.find((g) => g.url === gameUrl);
    const isAlreadyAnalysed = game?.blunder_count !== null && game?.blunder_count !== undefined;

    if (isAlreadyAnalysed) {
      return 'Loading game…';
    }

    return 'Analysing your games…';
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
    }, resolveLoadingTitle(gameUrl));
  };

  function handleTrainGame(gameUrl: string): void {
    buildSession({
      username,
      time_class: timeClass === 'all' ? 'rapid' : timeClass,
      n_games: 1,
      threshold,
      game_url: gameUrl,
      platform: platform ?? 'chesscom',
    }, resolveLoadingTitle(gameUrl));
  }

  function handleLogout(): void {
    logout();
  }

  // ── Mobile layout ─────────────────────────────────────────────────────────
  if (isMobile) {
    const platformLabel = platform === 'lichess' ? 'Lichess' : 'Chess.com';
    const fallbackSrc = platform === 'lichess' ? lichessLogo : chesscomLogo;

    return (
      <div className="setup--mobile">
        {/* Profile card */}
        <div className="setup__mobile-profile">
          <div className="setup__mobile-avatar">
            {avatar ? (
              <img
                src={avatar}
                alt={username}
                className="setup__mobile-avatar-img"
                onError={(e) => {
                  const target = e.currentTarget as HTMLImageElement;
                  target.src = fallbackSrc;
                  target.className = 'setup__mobile-avatar-logo';
                }}
              />
            ) : (
              <img
                src={fallbackSrc}
                alt={platformLabel}
                className="setup__mobile-avatar-logo"
              />
            )}
          </div>
          <div className="setup__mobile-profile-txt">
            <span className="setup__mobile-profile-name">{username}</span>
            <span className="setup__mobile-profile-meta">{platformLabel}</span>
          </div>

          {/* Settings button */}
          <div className="setup__mobile-settings-wrap">
            <button
              className="setup__mobile-settings-btn"
              type="button"
              onClick={() => setProfileSettingsOpen((v) => !v)}
              aria-label="Settings"
            >
              <img src={settingsIcon} alt="" className="setup__mobile-settings-ic" />
            </button>
            {profileSettingsOpen && (
              <>
                <div
                  className="setup__mobile-settings-scrim"
                  onClick={() => setProfileSettingsOpen(false)}
                />
                <div className="setup__mobile-settings-dropdown">
                  <button
                    type="button"
                    onClick={() => {
                      setDarkMode(!darkMode);
                      setProfileSettingsOpen(false);
                    }}
                  >
                    <span className="setup__mobile-dd-ic">{darkMode ? '☀' : '☾'}</span>
                    {darkMode ? 'Switch to light' : 'Switch to dark'}
                  </button>

                  {isAdmin && onAdminToggle && (
                    <button
                      type="button"
                      onClick={() => {
                        onAdminToggle();
                        setProfileSettingsOpen(false);
                      }}
                    >
                      <img src={settingsIcon} alt="" className="setup__mobile-dd-settings-ic" />
                      {adminView ? 'Exit admin' : 'Admin panel'}
                    </button>
                  )}

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        toggleMobileOverride();
                        setProfileSettingsOpen(false);
                      }}
                    >
                      <span className="setup__mobile-dd-ic">{mobileOverride ? '🖥' : '📱'}</span>
                      {mobileOverride ? 'Exit mobile preview' : 'Mobile preview on'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          <button
            className="setup__mobile-logout-btn"
            type="button"
            onClick={handleLogout}
          >
            Log out
          </button>
        </div>

        {/* Scrollable body */}
        <div className="setup__mobile-body">
          <div className="setup__mobile-card">
            <div className="setup__mobile-control">
              <span className="setup__mobile-label">Time Control</span>
              <TimeClassSelect value={timeClass} onChange={handleTimeClassChange} />
            </div>
            <div className="setup__mobile-control">
              <span className="setup__mobile-label">Sensitivity</span>
              <ThresholdPicker value={threshold} onChange={setThreshold} />
            </div>
          </div>

          <div className="setup__mobile-section">
            <h2>{showFavorites ? 'Saved Positions' : 'Recent Games'}</h2>
            <button
              type="button"
              className="setup__mobile-tab-btn"
              onClick={() => setShowFavorites((v) => !v)}
            >
              {showFavorites ? 'Recent games' : '★ Saved'}
            </button>
          </div>

          {showFavorites ? (
            <div className="setup__mobile-favorites-wrap">
              <Favorites onOpen={handleOpenFavorite} />
            </div>
          ) : (
            username && (
              <div className="setup__mobile-games-card">
                <GameHistory
                  username={username}
                  timeClass={timeClass}
                  isGuest={isGuest}
                  platform={platform ?? 'chesscom'}
                  threshold={threshold}
                  isMobile
                  onTrainGame={handleTrainGame}
                  onGamesLoaded={handleGamesLoaded}
                />
              </div>
            )
          )}

          <form onSubmit={handleSubmit} className="setup__mobile-submit-form">
            <button className="setup__mobile-submit" type="submit">
              Start Training
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Desktop layout ─────────────────────────────────────────────────────────
  return (
    <div className="setup">
      <div className="setup__hero">
        <span className="setup__hero-icon">♚</span>
        <h1 className="setup__hero-title">
          Chess <span className="setup__gold">Blunder</span> Trainer
        </h1>
        <p className="setup__hero-sub">Review your blunders like a daily puzzle</p>
      </div>

      {/* User identity chip — fixed bottom-left */}
      <div className="setup__user-row">
        {username && (
          <span className="setup__user-name">{username}</span>
        )}
        <button className="setup__logout-btn" type="button" onClick={handleLogout}>
          Log out
        </button>
      </div>

      <form className="setup__card" onSubmit={handleSubmit}>
        {/* ── Profile band ── */}
        <ProfileBand
          username={username}
          avatar={avatar}
          platform={platform}
          winRate30d={profileStats.winRate30d}
          gamesAnalysed={profileStats.gamesAnalysed}
          blundersDrilled={profileStats.blundersDrilled}
        />

        {/* ── Toolbar ── */}
        <div className="setup__toolbar">
          <div className="setup__field">
            <label className="setup__label">Time Control</label>
            <TimeClassSelect value={timeClass} onChange={handleTimeClassChange} />
          </div>

          <div className="setup__field">
            <label className="setup__label">Sensitivity</label>
            <ThresholdPicker value={threshold} onChange={setThreshold} />
          </div>

          <div className="setup__field">
            <label className="setup__label">&nbsp;</label>
            <div className="setup__settings-wrap">
              <button
                type="button"
                className="setup__icon-btn"
                title="Settings"
                onClick={() => setProfileSettingsOpen((v) => !v)}
              >
                ⚙
              </button>
              {profileSettingsOpen && (
                <>
                  <div
                    className="setup__settings-scrim"
                    onClick={() => setProfileSettingsOpen(false)}
                  />
                  <div className="setup__settings-dropdown">
                    <button
                      type="button"
                      onClick={() => {
                        setDarkMode(!darkMode);
                        setProfileSettingsOpen(false);
                      }}
                    >
                      <span className="setup__dd-ic">{darkMode ? '☀' : '☾'}</span>
                      {darkMode ? 'Switch to light' : 'Switch to dark'}
                    </button>

                    {isAdmin && onAdminToggle && (
                      <button
                        type="button"
                        onClick={() => {
                          onAdminToggle();
                          setProfileSettingsOpen(false);
                        }}
                      >
                        <img src={settingsIcon} alt="" className="setup__dd-settings-ic" />
                        {adminView ? 'Exit admin' : 'Admin panel'}
                      </button>
                    )}

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          toggleMobileOverride();
                          setProfileSettingsOpen(false);
                        }}
                      >
                        <span className="setup__dd-ic">📱</span>
                        {mobileOverride ? 'Exit mobile preview' : 'Mobile preview on'}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="setup__tabs">
            <button
              type="button"
              className={`setup__tab${!showFavorites ? ' setup__tab--on' : ''}`}
              onClick={() => setShowFavorites(false)}
            >
              <ListIconSvg />
              Recent games
            </button>
            <button
              type="button"
              className={`setup__tab${showFavorites ? ' setup__tab--on' : ''}`}
              onClick={() => setShowFavorites(true)}
            >
              <StarIconSvg />
              Saved
            </button>
          </div>
        </div>

        {/* ── Table area ── */}
        {!showFavorites && (
          <div className="setup__tablewrap">
            {username && (
              <GameHistory
                username={username}
                timeClass={timeClass}
                isGuest={isGuest}
                platform={platform ?? 'chesscom'}
                threshold={threshold}
                onTrainGame={handleTrainGame}
                onGamesLoaded={handleGamesLoaded}
              />
            )}
          </div>
        )}

        {/* ── Favorites panel ── */}
        {showFavorites && (
          <div className="setup__favs">
            <Favorites onOpen={handleOpenFavorite} />
          </div>
        )}

        {/* ── Footer / submit ── */}
        <div className="setup__footer">
          <button className="setup__submit" type="submit">
            Start Training
          </button>
        </div>
      </form>
    </div>
  );
}

export default SessionSetup;
