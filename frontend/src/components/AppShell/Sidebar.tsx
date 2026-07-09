/**
 * Left navigation sidebar — the persistent chrome for every authenticated
 * in-app screen. Also rendered as the body of the mobile slide-in drawer.
 *
 * Top: BlunderDrill mark + wordmark. Middle: the primary nav (Recent / Saved /
 * Statistics / Settings) plus an admin-only section. Bottom: the account name
 * and a logout button.
 */

import type { JSX } from 'react';
import useNav from '../../hooks/useNav';
import type { MenuSection } from '../../hooks/useNav';
import useSession from '../../hooks/useSession';
import useAuth from '../../hooks/useAuth';
import useSettings from '../../hooks/useSettings';
import logoutIcon from '../../assets/logout_icon.svg';

// The brand mark lives in /public and already carries its own gold background,
// so it fills the badge tile directly rather than sitting on a gradient.
const BRAND_LOGO_SRC = '/logo_uniform_bg.png';
import './Sidebar.css';

interface SidebarProps {
  isAdmin: boolean;
  adminView: boolean;
  onAdminToggle: () => void;
  /** Called after any navigation so the mobile drawer can close itself. */
  onNavigate: () => void;
}

// ── Inline nav icons (currentColor so they inherit the active/idle colour) ───

function RecentIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function SavedIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function StatsIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function DailyIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M12 13.5v3" />
      <line x1="12" y1="19" x2="12.01" y2="19" />
    </svg>
  );
}

function SettingsIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function AdminIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function WarningIcon(): JSX.Element {
  return (
    <svg className="sidebar__warning" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function MobilePreviewIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="7" y="2" width="10" height="20" rx="2" ry="2" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </svg>
  );
}

function Sidebar({ isAdmin, adminView, onAdminToggle, onNavigate }: SidebarProps): JSX.Element {
  const section = useNav((s) => s.section);
  const setSection = useNav((s) => s.setSection);
  const screen = useSession((s) => s.screen);
  const setScreen = useSession((s) => s.setScreen);
  const reset = useSession((s) => s.reset);
  const logout = useAuth((s) => s.logout);
  const email = useAuth((s) => s.email);
  const emailVerified = useAuth((s) => s.emailVerified);
  const isGuest = useAuth((s) => s.isGuest);
  const mobileOverride = useSettings((s) => s.mobileOverride);

  // Flag the Settings tab when the account has an email that still needs
  // confirming — the confirmation banner itself now lives in account settings.
  const emailNeedsConfirm = email !== undefined && !emailVerified && !isGuest;
  const toggleMobileOverride = useSettings((s) => s.toggleMobileOverride);

  // A menu section is only "active" while sitting on the setup screen; during the
  // trainer or settings screens no section pill is highlighted.
  const onMenu = screen === 'setup' && !adminView;

  // Route to one of the three menu sections. Leaves the admin dashboard, records
  // trainer progress via reset(), and otherwise just swaps the setup panel.
  function goToSection(next: MenuSection): void {
    setSection(next);

    if (adminView) {
      onAdminToggle();
    }

    if (screen === 'trainer' || screen === 'loading') {
      reset();
    } else {
      setScreen('setup');
    }

    onNavigate();
  }

  function goToSettings(): void {
    if (adminView) {
      onAdminToggle();
    }

    setScreen('settings');
    onNavigate();
  }

  // Navigate to the Blunder of the Day screen. Like Settings, it's its own
  // screen rather than a section of the setup menu.
  function goToDaily(): void {
    if (adminView) {
      onAdminToggle();
    }

    setScreen('daily');
    onNavigate();
  }

  function handleAdmin(): void {
    onAdminToggle();
    onNavigate();
  }

  function handleLogout(): void {
    logout();
    onNavigate();
  }

  return (
    <div className="sidebar">
      {/* ── Brand ── */}
      <div className="sidebar__brand">
        <span className="sidebar__brand-badge">
          <img className="sidebar__brand-logo" src={BRAND_LOGO_SRC} alt="" />
        </span>
        <span className="sidebar__brand-title">
          Blunder<span className="sidebar__brand-gold">Drill</span>
        </span>
      </div>

      {/* ── Primary nav ── */}
      <nav className="sidebar__nav">
        <button
          type="button"
          className={`sidebar__item${onMenu && section === 'recent' ? ' sidebar__item--active' : ''}`}
          onClick={() => goToSection('recent')}
        >
          <RecentIcon />
          <span className="sidebar__item-label">Recent games</span>
        </button>

        <button
          type="button"
          className={`sidebar__item${onMenu && section === 'saved' ? ' sidebar__item--active' : ''}`}
          onClick={() => goToSection('saved')}
        >
          <SavedIcon />
          <span className="sidebar__item-label">Saved games</span>
        </button>

        <button
          type="button"
          className={`sidebar__item${onMenu && section === 'stats' ? ' sidebar__item--active' : ''}`}
          onClick={() => goToSection('stats')}
        >
          <StatsIcon />
          <span className="sidebar__item-label">Statistics</span>
        </button>

        <button
          type="button"
          className={`sidebar__item${screen === 'daily' && !adminView ? ' sidebar__item--active' : ''}`}
          onClick={goToDaily}
        >
          <DailyIcon />
          <span className="sidebar__item-label">Blunder of the day</span>
        </button>

        <button
          type="button"
          className={`sidebar__item${screen === 'settings' && !adminView ? ' sidebar__item--active' : ''}`}
          onClick={goToSettings}
        >
          <SettingsIcon />
          <span className="sidebar__item-label">Settings</span>
          {emailNeedsConfirm && <WarningIcon />}
        </button>
      </nav>

      {/* ── Admin section (admins only) ── */}
      {isAdmin && (
        <div className="sidebar__section">
          <span className="sidebar__section-label">Admin</span>
          <button
            type="button"
            className={`sidebar__item${adminView ? ' sidebar__item--active' : ''}`}
            onClick={handleAdmin}
          >
            <AdminIcon />
            <span className="sidebar__item-label">{adminView ? 'Exit admin' : 'Admin dashboard'}</span>
          </button>
          <button
            type="button"
            className={`sidebar__item${mobileOverride ? ' sidebar__item--active' : ''}`}
            onClick={toggleMobileOverride}
          >
            <MobilePreviewIcon />
            <span className="sidebar__item-label">{mobileOverride ? 'Mobile preview: on' : 'Mobile preview'}</span>
          </button>
        </div>
      )}

      {/* ── Footer: logout ── */}
      <div className="sidebar__footer">
        <button type="button" className="sidebar__logout" onClick={handleLogout} title="Log out">
          <img className="sidebar__logout-ic" src={logoutIcon} alt="" />
          <span className="sidebar__item-label">Log out</span>
        </button>
      </div>
    </div>
  );
}

export default Sidebar;
