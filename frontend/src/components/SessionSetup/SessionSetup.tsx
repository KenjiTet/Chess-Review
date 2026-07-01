/** Setup screen — player identity, time control, game history, favorites. */

import { useState, useRef, useEffect } from 'react';
import type { JSX } from 'react';
import useSession from '../../hooks/useSession';
import useSettings from '../../hooks/useSettings';
import useAuth from '../../hooks/useAuth';
import Favorites from '../Favorites/Favorites';
import GameHistory from '../GameHistory/GameHistory';
import CategoryFilter from '../CategoryFilter/CategoryFilter';
import { ALL_CATEGORY_KEYS, ALL_PHASE_KEYS } from '../../constants/blunderCategories';
import ProfileBand from './ProfileBand';
import LinkAccountModal from './LinkAccountModal';
import UserStats from '../UserStats/UserStats';
import type { GameHistoryEntry } from '../../api/client.ts';
import { useMenuStats } from '../../hooks/useMenuStats';
import type { FavoritePosition } from '../../hooks/useFavorites';
import type { FavLayout } from '../Favorites/Favorites';
import { TimeClassIcon } from '../TimeClassIcons';
import ThresholdPicker from '../ThresholdPicker/ThresholdPicker';
import SeverityInfo from '../SeverityInfo/SeverityInfo';
import chesscomLogo from '../../assets/chesscom_logo.png';
import lichessLogo from '../../assets/Lichess_logo.webp';
import settingsIcon from '../../assets/settings.svg';
import linkIcon from '../../assets/link_icon.svg';
import logoutIcon from '../../assets/logout_icon.svg';
import blocIconUrl from '../../assets/bloc_icon.svg';
import inlineIconUrl from '../../assets/inline_icon.svg';
import './SessionSetup.css';
import './SessionSetup.mobile.css';

function SunIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3V4M12 20V21M4 12H3M6.31412 6.31412L5.5 5.5M17.6859 6.31412L18.5 5.5M6.31412 17.69L5.5 18.5001M17.6859 17.69L18.5 18.5001M21 12H20M16 12C16 14.2091 14.2091 16 12 16C9.79086 16 8 14.2091 8 12C8 9.79086 9.79086 8 12 8C14.2091 8 16 9.79086 16 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MoonIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 22C17.5228 22 22 17.5228 22 12C22 11.5373 21.3065 11.4608 21.0672 11.8568C19.9289 13.7406 17.8615 15 15.5 15C11.9101 15 9 12.0899 9 8.5C9 6.13845 10.2594 4.07105 12.1432 2.93276C12.5392 2.69347 12.4627 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" fill="currentColor" />
    </svg>
  );
}

const TIME_CLASSES = ['all', 'rapid', 'blitz', 'bullet', 'daily'] as const;
type TimeClass = (typeof TIME_CLASSES)[number];

const TIME_CLASS_STORAGE_KEY = 'recall_time_class';

function getSavedTimeClass(): TimeClass {
  const saved = localStorage.getItem(TIME_CLASS_STORAGE_KEY);

  if (saved && (TIME_CLASSES as readonly string[]).includes(saved)) {
    return saved as TimeClass;
  }

  return 'all';
}

// ── Persisted blunder-type / display filter ────────────────────────────────

const FILTER_CATEGORIES_KEY = 'recall_filter_categories';
const FILTER_PHASES_KEY = 'recall_filter_phases';
const SHOW_CLEAN_KEY = 'recall_filter_show_clean';
const SHOW_REVIEWED_KEY = 'recall_filter_show_reviewed';
const SHOW_ANALYSED_KEY = 'recall_filter_show_analysed';

function loadSelectedCategories(): Set<string> {
  try {
    const raw = localStorage.getItem(FILTER_CATEGORIES_KEY);

    if (raw === null) {
      return new Set(ALL_CATEGORY_KEYS);
    }

    // Keep only keys that still exist (drops removed types like positional).
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed.filter((key) => ALL_CATEGORY_KEYS.includes(key)));
  } catch {
    return new Set(ALL_CATEGORY_KEYS);
  }
}

function loadSelectedPhases(): Set<string> {
  try {
    const raw = localStorage.getItem(FILTER_PHASES_KEY);

    if (raw === null) {
      return new Set(ALL_PHASE_KEYS);
    }

    // Keep only keys that still exist (drops any removed phases).
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed.filter((key) => ALL_PHASE_KEYS.includes(key)));
  } catch {
    return new Set(ALL_PHASE_KEYS);
  }
}

// Display toggles default to true (show everything) when not previously saved.
function loadShowToggle(key: string): boolean {
  return localStorage.getItem(key) !== '0';
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
    function handleClickOutside(e: MouseEvent): void {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

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

function FilterIconSvg(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
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

function StatsIconSvg(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
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

  const threshold = useSettings((s) => s.threshold);
  const setThreshold = useSettings((s) => s.setThreshold);

  const authUsername = useAuth((s) => s.username);
  const isGuest = useAuth((s) => s.isGuest);
  const avatar = useAuth((s) => s.avatar);
  const platform = useAuth((s) => s.platform);
  const logout = useAuth((s) => s.logout);
  const getPlatformUsername = useAuth((s) => s.getPlatformUsername);

  const darkMode = useSettings((s) => s.darkMode);
  const setDarkMode = useSettings((s) => s.setDarkMode);
  const mobileOverride = useSettings((s) => s.mobileOverride);
  const toggleMobileOverride = useSettings((s) => s.toggleMobileOverride);

  const [showLinkModal, setShowLinkModal] = useState<boolean>(false);
  const [showFavorites, setShowFavorites] = useState<boolean>(false);
  const [favLayout, setFavLayout] = useState<FavLayout>('blocks');
  const [timeClass, setTimeClass] = useState<TimeClass>(getSavedTimeClass);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState<boolean>(false);
  // Whether the full User Stats dashboard overlay is open (shared by both layouts).
  const [showStats, setShowStats] = useState<boolean>(false);
  // Blunder-category filter — all categories selected and clean games shown by default.
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(loadSelectedCategories);
  // Game-phase filter — all phases selected by default.
  const [selectedPhases, setSelectedPhases] = useState<Set<string>>(loadSelectedPhases);
  const [showCleanGames, setShowCleanGames] = useState<boolean>(() => loadShowToggle(SHOW_CLEAN_KEY));
  const [showReviewedGames, setShowReviewedGames] = useState<boolean>(() => loadShowToggle(SHOW_REVIEWED_KEY));
  const [showAnalysedGames, setShowAnalysedGames] = useState<boolean>(() => loadShowToggle(SHOW_ANALYSED_KEY));
  // Whether the collapsible filter section is expanded.
  const [filterOpen, setFilterOpen] = useState<boolean>(false);
  // True when the filter differs from its defaults (drives the button's active dot).
  const filterActive = selectedCategories.size !== ALL_CATEGORY_KEYS.length
    || selectedPhases.size !== ALL_PHASE_KEYS.length
    || !showCleanGames
    || !showReviewedGames
    || !showAnalysedGames;

  // Persist the filter so it survives page reloads and entering/leaving the trainer.
  useEffect(() => {
    localStorage.setItem(FILTER_CATEGORIES_KEY, JSON.stringify([...selectedCategories]));
  }, [selectedCategories]);

  useEffect(() => {
    localStorage.setItem(FILTER_PHASES_KEY, JSON.stringify([...selectedPhases]));
  }, [selectedPhases]);

  useEffect(() => {
    localStorage.setItem(SHOW_CLEAN_KEY, showCleanGames ? '1' : '0');
  }, [showCleanGames]);

  useEffect(() => {
    localStorage.setItem(SHOW_REVIEWED_KEY, showReviewedGames ? '1' : '0');
  }, [showReviewedGames]);

  useEffect(() => {
    localStorage.setItem(SHOW_ANALYSED_KEY, showAnalysedGames ? '1' : '0');
  }, [showAnalysedGames]);

  const username = authUsername ?? '';
  // Account username drives display; the linked platform handle drives game/profile fetches.
  const playerUsername = getPlatformUsername(platform ?? 'chesscom') ?? '';
  // Any logged-in, non-guest account can link/relink a platform handle — even
  // when none is linked yet (those accounts need the option most).
  const isRegisteredAccount = !isGuest && authUsername !== undefined;

  // Single source of truth for every menu stat — both layouts read from this so
  // their displayed numbers can never diverge.
  const { stats: menuStats, statItems, setLoadedGames, refreshStats } = useMenuStats({
    playerUsername,
    platform,
    timeClass,
    threshold,
  });

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
      prevFen: fav.prevFen,
      prevMoveUci: fav.prevMoveUci,
      uciPlayed: fav.uciPlayed,
    });
  }

  function handleGamesLoaded(games: GameHistoryEntry[]): void {
    gamesRef.current = games;

    // Feed the loaded list to the shared stats hook; it derives win rate (30d)
    // and games-analysed count for both layouts.
    setLoadedGames(games);
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

  function handleToggleCategory(key: string): void {
    setSelectedCategories((prev) => {
      const next = new Set(prev);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }

  function handleTogglePhase(key: string): void {
    setSelectedPhases((prev) => {
      const next = new Set(prev);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }

  function renderFilterButton(extraClass?: string): JSX.Element {
    return (
      <button
        type="button"
        className={`setup__filterbtn${filterOpen ? ' setup__filterbtn--on' : ''}${extraClass !== undefined ? ` ${extraClass}` : ''}`}
        onClick={() => setFilterOpen((open) => !open)}
        aria-expanded={filterOpen}
        aria-label="Filter games by blunder type"
      >
        <FilterIconSvg />
        {filterActive && <span className="setup__filterbtn-dot" />}
      </button>
    );
  }

  function renderFilterPanel(mobile: boolean = false): JSX.Element {
    return (
      <div className={`setup__filterpanel${filterOpen ? ' setup__filterpanel--open' : ''}`}>
        <div className="setup__filterpanel-inner">
          {/* On mobile the Time Control + Severity pickers live inside the filter
              panel rather than the cramped section row above it. */}
          {mobile && (
            <div className="setup__mobile-filtercontrols">
              <div className="setup__mobile-field setup__mobile-field--tc">
                <span className="setup__mobile-label">Time Control</span>
                <TimeClassSelect value={timeClass} onChange={handleTimeClassChange} />
              </div>
              <div className="setup__mobile-field setup__mobile-field--sev">
                <span className="setup__mobile-label setup__mobile-label--row">
                  Severity
                  <SeverityInfo />
                </span>
                <ThresholdPicker value={threshold} onChange={setThreshold} />
              </div>
            </div>
          )}

          <CategoryFilter
            selected={selectedCategories}
            onToggle={handleToggleCategory}
            selectedPhases={selectedPhases}
            onTogglePhase={handleTogglePhase}
            showClean={showCleanGames}
            onToggleClean={setShowCleanGames}
            showReviewed={showReviewedGames}
            onToggleReviewed={setShowReviewedGames}
            showAnalysed={showAnalysedGames}
            onToggleAnalysed={setShowAnalysedGames}
            isMobile={mobile}
          />
        </div>
      </div>
    );
  }

  function handleTrainGame(gameUrl: string): void {
    // When every category is selected, omit the filter so the session trains all
    // types; otherwise scope the review to the chosen categories.
    const allSelected = selectedCategories.size === ALL_CATEGORY_KEYS.length;
    const categories = allSelected ? undefined : Array.from(selectedCategories);

    buildSession({
      username: playerUsername,
      time_class: timeClass === 'all' ? 'rapid' : timeClass,
      n_games: 1,
      threshold,
      game_url: gameUrl,
      platform: platform ?? 'chesscom',
      categories,
    }, resolveLoadingTitle(gameUrl));
  }

  // Open the trainer for a single blunder type in one game, optionally scoped to
  // a game phase. Drilled straight from a breakdown pill, so it ignores the
  // category filter and trains exactly the clicked type.
  function handleTrainBlunders(gameUrl: string, category: string, phase?: string): void {
    buildSession({
      username: playerUsername,
      time_class: timeClass === 'all' ? 'rapid' : timeClass,
      n_games: 1,
      threshold,
      game_url: gameUrl,
      platform: platform ?? 'chesscom',
      categories: [category],
      phase,
    }, resolveLoadingTitle(gameUrl));
  }

  function handleLogout(): void {
    logout();
  }

  // ── View switching ──────────────────────────────────────────────────────
  // The "Showing" toggle is tri-state (Recent / Saved / Stats); these keep the
  // two booleans mutually exclusive so only one panel renders at a time.
  function showRecentView(): void {
    setShowFavorites(false);
    setShowStats(false);
  }

  function showSavedView(): void {
    setShowFavorites(true);
    setShowStats(false);
  }

  function showStatsView(): void {
    setShowFavorites(false);
    setShowStats(true);
  }

  // ── Mobile layout ─────────────────────────────────────────────────────────
  if (isMobile) {
    const platformLabel = platform === 'lichess' ? 'Lichess' : 'Chess.com';
    const fallbackSrc = platform === 'lichess' ? lichessLogo : chesscomLogo;
    const memberSince = menuStats.ratings?.joined_year;
    // Prefer the avatar fetched for the linked handle; fall back to the auth-store avatar.
    const mobileAvatarSrc = menuStats.ratings?.avatar ?? avatar;

    return (
      <div className="setup--mobile">
        {/* Profile header */}
        <div className="setup__mobile-profile">
          {/* Top row: avatar + name/meta + gear + logout */}
          <div className="setup__mobile-profile-row">
            <div className="setup__mobile-avatar">
              {mobileAvatarSrc ? (
                <img
                  src={mobileAvatarSrc}
                  alt={playerUsername}
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
              <span className="setup__mobile-profile-name">{playerUsername}</span>
              <span className="setup__mobile-profile-meta">
                {platformLabel}
                {memberSince !== undefined && memberSince !== null && (
                  <> · Since {memberSince}</>
                )}
              </span>
            </div>

            {/* Settings wheel — single entry point for theme, account linking,
                admin tools and logout, keeping the banner compact */}
            <div className="setup__mobile-settings-wrap">
              <button
                className="setup__mobile-settings-btn"
                type="button"
                onClick={() => setProfileSettingsOpen((v) => !v)}
                aria-label="Settings"
                aria-expanded={profileSettingsOpen}
              >
                <img src={settingsIcon} alt="" className="setup__mobile-settings-ic" />
              </button>
              {profileSettingsOpen && (
                <>
                  <div
                    className="setup__mobile-settings-scrim"
                    onClick={() => setProfileSettingsOpen(false)}
                  />
                  <div className="setup__mobile-settings-dropdown" role="menu">
                    {/* Theme */}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setDarkMode(!darkMode);
                        setProfileSettingsOpen(false);
                      }}
                    >
                      <span className="setup__mobile-dd-ic">{darkMode ? '☀' : '☾'}</span>
                      {darkMode ? 'Switch to light' : 'Switch to dark'}
                    </button>

                    {/* Link / change linked platform account */}
                    {isRegisteredAccount && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowLinkModal(true);
                          setProfileSettingsOpen(false);
                        }}
                      >
                        <img src={linkIcon} alt="" className="setup__mobile-dd-img-ic" />
                        Link account
                      </button>
                    )}

                    {/* Admin-only tools */}
                    {isAdmin && onAdminToggle && (
                      <button
                        type="button"
                        role="menuitem"
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
                        role="menuitem"
                        onClick={() => {
                          toggleMobileOverride();
                          setProfileSettingsOpen(false);
                        }}
                      >
                        <span className="setup__mobile-dd-ic">{mobileOverride ? '🖥' : '📱'}</span>
                        {mobileOverride ? 'Exit mobile preview' : 'Mobile preview on'}
                      </button>
                    )}

                    {/* Logout — separated as a destructive action */}
                    <div className="setup__mobile-dd-divider" />
                    <button
                      type="button"
                      role="menuitem"
                      className="setup__mobile-dd-danger"
                      onClick={() => {
                        handleLogout();
                        setProfileSettingsOpen(false);
                      }}
                    >
                      <img src={logoutIcon} alt="" className="setup__mobile-dd-img-ic setup__mobile-dd-img-ic--danger" />
                      Log out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ELO strip */}
          <div className="setup__mobile-elostrip">
            {/* Rapid */}
            <button
              type="button"
              className={`setup__mobile-elostrip__cell setup__mobile-elostrip__cell--btn${timeClass === 'rapid' ? ' setup__mobile-elostrip__cell--active' : ''}`}
              onClick={() => handleTimeClassChange('rapid')}
            >
              <span className="setup__mobile-elostrip__ic">
                <TimeClassIcon tc="rapid" size={15} />
              </span>
              {menuStats.ratingsLoading ? (
                <span className="setup__mobile-elostrip__skeleton" />
              ) : (
                <span className="setup__mobile-elostrip__num">
                  {menuStats.ratings?.rapid_rating ?? '—'}
                </span>
              )}
              <span className="setup__mobile-elostrip__lbl">Rapid</span>
            </button>

            {/* Blitz */}
            <button
              type="button"
              className={`setup__mobile-elostrip__cell setup__mobile-elostrip__cell--btn${timeClass === 'blitz' ? ' setup__mobile-elostrip__cell--active' : ''}`}
              onClick={() => handleTimeClassChange('blitz')}
            >
              <span className="setup__mobile-elostrip__ic">
                <TimeClassIcon tc="blitz" size={15} />
              </span>
              {menuStats.ratingsLoading ? (
                <span className="setup__mobile-elostrip__skeleton" />
              ) : (
                <span className="setup__mobile-elostrip__num">
                  {menuStats.ratings?.blitz_rating ?? '—'}
                </span>
              )}
              <span className="setup__mobile-elostrip__lbl">Blitz</span>
            </button>

            {/* Bullet */}
            <button
              type="button"
              className={`setup__mobile-elostrip__cell setup__mobile-elostrip__cell--btn${timeClass === 'bullet' ? ' setup__mobile-elostrip__cell--active' : ''}`}
              onClick={() => handleTimeClassChange('bullet')}
            >
              <span className="setup__mobile-elostrip__ic">
                <TimeClassIcon tc="bullet" size={15} />
              </span>
              {menuStats.ratingsLoading ? (
                <span className="setup__mobile-elostrip__skeleton" />
              ) : (
                <span className="setup__mobile-elostrip__num">
                  {menuStats.ratings?.bullet_rating ?? '—'}
                </span>
              )}
              <span className="setup__mobile-elostrip__lbl">Bullet</span>
            </button>

            {/* Mobile has limited width — show only avg blunders alongside the ratings. */}
            {statItems
              .filter((item) => item.key === 'avg-blunders')
              .map((item, index) => (
                <div className="setup__mobile-elostrip__cell" key={`mobile-stat-${item.key}-${index}`}>
                  <span className="setup__mobile-elostrip__ic setup__mobile-elostrip__ic--pct">
                    {item.value}
                  </span>
                  <span className="setup__mobile-elostrip__num setup__mobile-elostrip__num--gold">
                    Avg
                  </span>
                  <span className="setup__mobile-elostrip__lbl">Blunders</span>
                </div>
              ))}
          </div>
        </div>

        {/* Scrollable body */}
        <div className="setup__mobile-body">
          <div className="setup__mobile-games-panel">
            <div className="setup__mobile-section">
              {/* Left side — Recent/Saved/Stats icon-only tabs */}
              <div className="setup__mobile-field setup__mobile-field--tabs">
                <span className="setup__mobile-label">Showing</span>
                <div className="setup__seg setup__seg--mobile setup__seg--tabs">
                  <button
                    type="button"
                    className={`setup__seg-btn${!showFavorites && !showStats ? ' setup__seg-btn--on' : ''}`}
                    onClick={showRecentView}
                    aria-label="Recent games"
                  >
                    <ListIconSvg />
                    <span className="setup__seg-btn-txt">Games</span>
                  </button>
                  <button
                    type="button"
                    className={`setup__seg-btn${showFavorites ? ' setup__seg-btn--on' : ''}`}
                    onClick={showSavedView}
                    aria-label="Saved positions"
                  >
                    <StarIconSvg />
                    <span className="setup__seg-btn-txt">Saved</span>
                  </button>
                  <button
                    type="button"
                    className={`setup__seg-btn${showStats ? ' setup__seg-btn--on' : ''}`}
                    onClick={showStatsView}
                    aria-label="User stats"
                  >
                    <StatsIconSvg />
                    <span className="setup__seg-btn-txt">Stats</span>
                  </button>
                </div>
              </div>

              {/* Right side — Filter button (Recent) or layout toggle (Saved) */}
              {!showFavorites && !showStats && (
                <div className="setup__mobile-field setup__mobile-field--filter">
                  <span className="setup__mobile-label">Filter</span>
                  {renderFilterButton('setup__filterbtn--mobile')}
                </div>
              )}

              {showFavorites && (
                <div className="setup__mobile-field setup__mobile-field--grow">
                  <span className="setup__mobile-label">Layout</span>
                  <div className="setup__seg setup__seg--mobile setup__seg--layout">
                    <button
                      type="button"
                      className={`setup__seg-btn${favLayout === 'blocks' ? ' setup__seg-btn--on' : ''}`}
                      onClick={() => setFavLayout('blocks')}
                      aria-label="Blocks layout"
                    >
                      <img className="setup__seg-btn-ic" src={blocIconUrl} alt="" />
                    </button>
                    <button
                      type="button"
                      className={`setup__seg-btn${favLayout === 'inline' ? ' setup__seg-btn--on' : ''}`}
                      onClick={() => setFavLayout('inline')}
                      aria-label="Inline layout"
                    >
                      <img className="setup__seg-btn-ic" src={inlineIconUrl} alt="" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {showStats && (
              playerUsername && (
                <div className="setup__mobile-stats-wrap">
                  <UserStats handle={playerUsername} platform={platform ?? 'chesscom'} />
                </div>
              )
            )}

            {showFavorites && (
              <div className="setup__mobile-favorites-wrap">
                <Favorites onOpen={handleOpenFavorite} layout={favLayout} />
              </div>
            )}

            {!showFavorites && !showStats && playerUsername && (
              <>
                {renderFilterPanel(true)}
                <GameHistory
                  username={playerUsername}
                  timeClass={timeClass}
                  isGuest={isGuest}
                  platform={platform ?? 'chesscom'}
                  threshold={threshold}
                  isMobile
                  selectedCategories={selectedCategories}
                  selectedPhases={selectedPhases}
                  showCleanGames={showCleanGames}
                  showReviewedGames={showReviewedGames}
                  showAnalysedGames={showAnalysedGames}
                  onTrainGame={handleTrainGame}
                  onTrainBlunders={handleTrainBlunders}
                  onGamesLoaded={handleGamesLoaded}
                  onAnalysisComplete={refreshStats}
                />
              </>
            )}
          </div>
        </div>

        {showLinkModal && isRegisteredAccount && (
          <LinkAccountModal onClose={() => setShowLinkModal(false)} />
        )}
      </div>
    );
  }

  // ── Desktop layout ─────────────────────────────────────────────────────────
  return (
    <div className="setup">
      {/* Settings / theme button — fixed at the top-right of the screen */}
      <div className="setup__topright">
        {isAdmin ? (
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
                <div className="setup__settings-dropdown setup__settings-dropdown--right">
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

                  {onAdminToggle && (
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
                </div>
              </>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="setup__icon-btn setup__theme-btn"
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setDarkMode(!darkMode)}
          >
            {darkMode ? <SunIcon /> : <MoonIcon />}
          </button>
        )}
      </div>

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
        {isRegisteredAccount && (
          <button className="setup__logout-btn" type="button" onClick={() => setShowLinkModal(true)}>
            Link account
          </button>
        )}
        <button className="setup__logout-btn" type="button" onClick={handleLogout}>
          Log out
        </button>
      </div>

      <div className="setup__card">
        {/* ── Profile band ── */}
        <ProfileBand
          username={playerUsername}
          avatar={avatar}
          platform={platform}
          ratings={menuStats.ratings}
          ratingsLoading={menuStats.ratingsLoading}
          statItems={statItems}
          activeTimeClass={timeClass}
          onSelectTimeClass={handleTimeClassChange}
        />

        {/* ── Toolbar ── */}
        <div className="setup__toolbar">
          {/* Showing tabs — kept on the left of the toolbar */}
          <div className="setup__field setup__field--tabs">
            <label className="setup__label">Showing</label>
            <div className="setup__seg setup__seg--tabs">
              <button
                type="button"
                className={`setup__seg-btn${!showFavorites && !showStats ? ' setup__seg-btn--on' : ''}`}
                onClick={showRecentView}
              >
                <ListIconSvg />
                Recent games
              </button>
              <button
                type="button"
                className={`setup__seg-btn${showFavorites ? ' setup__seg-btn--on' : ''}`}
                onClick={showSavedView}
              >
                <StarIconSvg />
                Saved
              </button>
              <button
                type="button"
                className={`setup__seg-btn${showStats ? ' setup__seg-btn--on' : ''}`}
                onClick={showStatsView}
              >
                <StatsIconSvg />
                Stats
              </button>
            </div>
          </div>

          {!showFavorites && !showStats && (
            <>
              <div className="setup__field">
                <label className="setup__label">Time Control</label>
                <TimeClassSelect value={timeClass} onChange={handleTimeClassChange} />
              </div>

              <div className="setup__field">
                <span className="setup__label setup__label--row">
                  Blunder severity
                  <SeverityInfo />
                </span>
                <ThresholdPicker value={threshold} onChange={setThreshold} />
              </div>

              <div className="setup__field">
                <label className="setup__label">Filter</label>
                {renderFilterButton()}
              </div>
            </>
          )}

          {showFavorites && (
            <div className="setup__field">
              <label className="setup__label">Layout</label>
              <div className="setup__seg">
                <button
                  type="button"
                  className={`setup__seg-btn${favLayout === 'blocks' ? ' setup__seg-btn--on' : ''}`}
                  onClick={() => setFavLayout('blocks')}
                >
                  <img className="setup__seg-btn-ic" src={blocIconUrl} alt="" />
                  Blocks
                </button>
                <button
                  type="button"
                  className={`setup__seg-btn${favLayout === 'inline' ? ' setup__seg-btn--on' : ''}`}
                  onClick={() => setFavLayout('inline')}
                >
                  <img className="setup__seg-btn-ic" src={inlineIconUrl} alt="" />
                  Inline
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Table area (Recent games) ── */}
        {!showFavorites && !showStats && (
          <div className="setup__tablewrap">
            {playerUsername && (
              <>
                {renderFilterPanel()}
                <GameHistory
                  username={playerUsername}
                  timeClass={timeClass}
                  isGuest={isGuest}
                  platform={platform ?? 'chesscom'}
                  threshold={threshold}
                  selectedCategories={selectedCategories}
                  selectedPhases={selectedPhases}
                  showCleanGames={showCleanGames}
                  showReviewedGames={showReviewedGames}
                  showAnalysedGames={showAnalysedGames}
                  onTrainGame={handleTrainGame}
                  onTrainBlunders={handleTrainBlunders}
                  onGamesLoaded={handleGamesLoaded}
                  onAnalysisComplete={refreshStats}
                />
              </>
            )}
          </div>
        )}

        {/* ── Stats panel ── */}
        {showStats && playerUsername && (
          <div className="setup__tablewrap">
            <UserStats handle={playerUsername} platform={platform ?? 'chesscom'} />
          </div>
        )}

        {/* ── Favorites panel ── */}
        {showFavorites && (
          <div className="setup__favs">
            <Favorites onOpen={handleOpenFavorite} layout={favLayout} />
          </div>
        )}
      </div>

      {showLinkModal && isRegisteredAccount && (
        <LinkAccountModal onClose={() => setShowLinkModal(false)} />
      )}
    </div>
  );
}

export default SessionSetup;
