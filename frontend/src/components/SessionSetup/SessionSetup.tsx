/** Setup screen — time control, game history, favorites (profile lives in the shell header). */

import { useState, useRef, useEffect } from 'react';
import type { JSX } from 'react';
import useSession from '../../hooks/useSession';
import useSettings from '../../hooks/useSettings';
import useAuth from '../../hooks/useAuth';
import useNav from '../../hooks/useNav';
import type { TimeClass } from '../../hooks/useNav';
import { useMenuData } from '../AppShell/MenuDataContext';
import Favorites from '../Favorites/Favorites';
import GameHistory from '../GameHistory/GameHistory';
import CategoryFilter from '../CategoryFilter/CategoryFilter';
import { ALL_CATEGORY_KEYS, ALL_PHASE_KEYS } from '../../constants/blunderCategories';
import UserStats from '../UserStats/UserStats';
import type { GameHistoryEntry } from '../../api/client.ts';
import type { FavoritePosition } from '../../hooks/useFavorites';
import type { FavLayout } from '../Favorites/Favorites';
import { TimeClassIcon } from '../TimeClassIcons';
import ThresholdPicker from '../ThresholdPicker/ThresholdPicker';
import SeverityInfo from '../SeverityInfo/SeverityInfo';
import chesscomLogo from '../../assets/chesscom_logo.png';
import lichessLogo from '../../assets/Lichess_logo.webp';
import blocIconUrl from '../../assets/bloc_icon.svg';
import inlineIconUrl from '../../assets/inline_icon.svg';
import './SessionSetup.css';
import './SessionSetup.mobile.css';

// Options for the Time Control select; the active value + persistence live in useNav.
const TIME_CLASSES: readonly TimeClass[] = ['all', 'rapid', 'blitz', 'bullet', 'daily'];

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

// ── Toolbar SVG icons ──────────────────────────────────────────────────────

function FilterIconSvg(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface SessionSetupProps {
  isMobile?: boolean;
}

function SessionSetup({ isMobile = false }: SessionSetupProps): JSX.Element {
  const buildSession = useSession((s) => s.buildSession);
  const loadFavoritePosition = useSession((s) => s.loadFavoritePosition);

  const threshold = useSettings((s) => s.threshold);
  const setThreshold = useSettings((s) => s.setThreshold);

  const isGuest = useAuth((s) => s.isGuest);

  // Shared player data + stats live in the shell-level MenuData context so the
  // sticky ProfileHeader and this content stay in sync from one source.
  const {
    playerUsername,
    platform,
    avatar,
    timeClass,
    setTimeClass,
    menuStats,
    statItems,
    setLoadedGames,
    refreshStats,
  } = useMenuData();

  // The active menu view is driven by the sidebar (AppShell) via useNav; these
  // derived booleans keep the existing render branches unchanged.
  const section = useNav((s) => s.section);
  const showFavorites = section === 'saved';
  const showStats = section === 'stats';

  const [favLayout, setFavLayout] = useState<FavLayout>('blocks');
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

  // Setting the time class persists via the store; keep the local name so the
  // existing handlers/JSX don't need to change.
  const handleTimeClassChange = setTimeClass;

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
          {/* Time Control lives in the section row above; the filter panel keeps
              the blunder-severity (threshold) picker. */}
          {mobile && (
            <div className="setup__mobile-filtercontrols">
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
            {/* Controls row: Recent shows Time Control (left) + Filter (right);
                Saved/Stats keep a section title, with a layout toggle for Saved. */}
            <div className="setup__mobile-section">
              {!showFavorites && !showStats && (
                <>
                  <div className="setup__mobile-field setup__mobile-field--tc">
                    <span className="setup__mobile-label">Time Control</span>
                    <TimeClassSelect value={timeClass} onChange={handleTimeClassChange} />
                  </div>
                  <div className="setup__mobile-field setup__mobile-field--filter">
                    <span className="setup__mobile-label">Filter</span>
                    {renderFilterButton('setup__filterbtn--mobile')}
                  </div>
                </>
              )}

              {showFavorites && (
                <>
                  <span className="setup__mobile-section-title">Saved games</span>
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
                </>
              )}

              {showStats && (
                <span className="setup__mobile-section-title">Statistics</span>
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
      </div>
    );
  }

  // ── Desktop layout ─────────────────────────────────────────────────────────
  // The player profile now lives in the shell's sticky ProfileHeader; this
  // content fills the region below it.
  return (
    <div className="setup">
      <div className="setup__card">
        {/* ── Toolbar ── */}
        <div className="setup__toolbar">
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

              <div className="setup__field setup__field--filter">
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
    </div>
  );
}

export default SessionSetup;
