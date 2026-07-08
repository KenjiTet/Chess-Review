/**
 * Full-page application shell for authenticated in-app screens.
 *
 * Desktop (>= 768px): a persistent left Sidebar sits beside a flex column that
 * stacks a sticky ProfileHeader, the scrollable screen content, and a pinned
 * Footer. Mobile (< 768px): the sidebar becomes an overlay drawer behind a top
 * app-bar; the mobile SessionSetup keeps its own compact profile header.
 *
 * The content region carries a solid background so the global body image never
 * shows through (App also drops it via the data-app-shell attribute).
 */

import { useState } from 'react';
import type { JSX, ReactNode } from 'react';
import useSession from '../../hooks/useSession';
import Sidebar from './Sidebar';
import ProfileHeader from './ProfileHeader';
import Footer from '../Footer/Footer';
import { MenuDataProvider } from './MenuDataContext';
import './AppShell.css';

interface AppShellProps {
  children: ReactNode;
  isMobile: boolean;
  isAdmin: boolean;
  adminView: boolean;
  onAdminToggle: () => void;
}

function AppShell({ children, isMobile, isAdmin, adminView, onAdminToggle }: AppShellProps): JSX.Element {
  const screen = useSession((s) => s.screen);
  // Only meaningful on mobile — the drawer's open/closed state.
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);

  function closeDrawer(): void {
    setDrawerOpen(false);
  }

  // The profile header belongs only on the session-setup menu — not on
  // settings, the focused trainer/loading screens, or the admin dashboard.
  const showHeader = !adminView && screen === 'setup';

  // The footer anchors the menu pages, forming one continuous bottom bar with
  // the sidebar's logout row. It's dropped on the focused trainer/loading
  // screens and the admin dashboard.
  const showFooter = !adminView && screen !== 'trainer' && screen !== 'loading';

  // ── Mobile: top bar + slide-in drawer ──
  if (isMobile) {
    return (
      <MenuDataProvider>
        <div className="shell shell--mobile">
          <header className="shell__topbar">
            {/* Brand (logo + wordmark) lives only in the expanded drawer/sidebar
                now — the top bar just carries the menu toggle. */}
            <button
              className="shell__hamburger"
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
            >
              <span />
              <span />
              <span />
            </button>
          </header>

          <div className={`shell__drawer${drawerOpen ? ' shell__drawer--open' : ''}`}>
            <Sidebar
              isAdmin={isAdmin}
              adminView={adminView}
              onAdminToggle={onAdminToggle}
              onNavigate={closeDrawer}
            />
          </div>
          {drawerOpen && <div className="shell__scrim" onClick={closeDrawer} />}

          <main className="shell__main">
            <div className="shell__content">{children}</div>
            {showFooter && <Footer isMobile />}
          </main>
        </div>
      </MenuDataProvider>
    );
  }

  // ── Desktop: persistent sidebar ──
  return (
    <MenuDataProvider>
      <div className="shell">
        <aside className="shell__sidebar">
          <Sidebar
            isAdmin={isAdmin}
            adminView={adminView}
            onAdminToggle={onAdminToggle}
            onNavigate={closeDrawer}
          />
        </aside>
        <main className="shell__main">
          {showHeader && <ProfileHeader />}
          <div className="shell__content">{children}</div>
          {showFooter && <Footer />}
        </main>
      </div>
    </MenuDataProvider>
  );
}

export default AppShell;
