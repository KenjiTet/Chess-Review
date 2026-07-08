/** App entry point — routes to the active screen based on session and auth state. */

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import useSession from './hooks/useSession';
import type { Screen } from './hooks/useSession';
import { decodeSharePayload } from './utils/sharePosition';
import { confirmEmail } from './api/client';
import useSettings from './hooks/useSettings';
import useAuth from './hooks/useAuth';
import useFavorites from './hooks/useFavorites';
import useReviewed from './hooks/useReviewed';
import useIsMobile from './hooks/useIsMobile';
import ErrorBanner from './components/ErrorBanner/ErrorBanner';
import Footer from './components/Footer/Footer';
import Landing from './components/Landing/Landing';
import SessionSetup from './components/SessionSetup/SessionSetup';
import Loading from './components/Loading/Loading';
import Trainer from './components/Trainer/Trainer';
import Admin from './components/Admin/Admin';
import Settings from './components/Settings/Settings';
import AppShell from './components/AppShell/AppShell';
import Terms from './components/Legal/Terms';
import Privacy from './components/Legal/Privacy';
import ResetPassword from './components/ResetPassword/ResetPassword';
import './App.css';

interface ScreenProps {
  isMobile: boolean;
  isAdmin: boolean;
  adminView: boolean;
  resetToken: string | undefined;
}

// Public, chrome-free screens reachable with or without authentication.
const PUBLIC_SCREENS: readonly Screen[] = ['reset', 'terms', 'privacy'];

// Renders the active in-app screen content (everything that lives inside the
// AppShell for authenticated users). Public/landing screens are handled in App.
function renderScreen(screen: Screen, props: ScreenProps): JSX.Element {
  const { isMobile, isAdmin, adminView } = props;

  if (adminView && isAdmin) {
    return <Admin />;
  }

  if (screen === 'settings') {
    return <Settings />;
  }

  if (screen === 'loading') {
    return <Loading />;
  }

  if (screen === 'trainer') {
    return <Trainer isMobile={isMobile} />;
  }

  // Default in-app screen is the setup menu.
  return <SessionSetup isMobile={isMobile} />;
}

function App(): JSX.Element {
  const screen = useSession((s) => s.screen);
  const darkMode = useSettings((s) => s.darkMode);
  const mobileOverride = useSettings((s) => s.mobileOverride);
  const username = useAuth((s) => s.username);
  const isAdmin = useAuth((s) => s.isAdmin);
  const getNamespace = useAuth((s) => s.getNamespace);
  const [adminView, setAdminView] = useState<boolean>(false);
  const [resetToken, setResetToken] = useState<string | undefined>(undefined);
  // Ensures a confirmation token is only ever redeemed once per page load.
  const confirmHandledRef = useRef<boolean>(false);

  const isAuthenticated = username !== undefined;
  const isMobileViewport = useIsMobile();
  const isMobile = isMobileViewport || mobileOverride;

  // On first mount, stash any ?share= param so we can load it after auth.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareParam = params.get('share');

    if (shareParam) {
      sessionStorage.setItem('recall_pending_share', shareParam);
      // Remove the param from the URL without a page reload.
      const clean = new URL(window.location.href);
      clean.searchParams.delete('share');
      window.history.replaceState(null, '', clean.toString());
    }
  }, []);

  // On first mount, handle email-confirmation and password-reset links.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const confirmToken = params.get('confirm');
    const resetParam = params.get('reset');

    // Strip a handled param from the URL so a refresh doesn't re-trigger it.
    function stripParam(name: string): void {
      const clean = new URL(window.location.href);
      clean.searchParams.delete(name);
      window.history.replaceState(null, '', clean.toString());
    }

    // Guard against processing the same token twice (StrictMode remount, a
    // service-worker-triggered reload, etc.) — a confirm token is single-use, so
    // a second call would spuriously report "invalid or expired".
    if (confirmToken && !confirmHandledRef.current) {
      confirmHandledRef.current = true;
      stripParam('confirm');
      void confirmEmail(confirmToken)
        .then((res) => {
          // Sync the store from the response so the confirmed email + verified
          // state show up in account settings even when this link is opened in a
          // session that hadn't loaded the email yet. The confirmation status is
          // surfaced on the account settings page itself — no app-wide banner.
          if (res.email) {
            useAuth.getState().setAccountEmail(res.email);
          }

          useAuth.getState().setEmailVerified(res.email_verified ?? true);
        })
        .catch(() => {
          // Swallow — a failed confirmation leaves the email showing as
          // unconfirmed in account settings, which already prompts a resend.
        });
    }

    if (resetParam) {
      stripParam('reset');
      setResetToken(resetParam);
      useSession.getState().setScreen('reset');
    }
  }, []);

  // On first mount, reload user-namespaced stores if a session was already stored.
  useEffect(() => {
    if (isAuthenticated) {
      const ns = getNamespace();
      useSettings.getState().reloadForUser(ns);
      useFavorites.getState().reloadForUser(ns);
      void useReviewed.getState().loadFromServer();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After auth resolves, load any pending shared position.
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const pending = sessionStorage.getItem('recall_pending_share');

    if (!pending) {
      return;
    }

    sessionStorage.removeItem('recall_pending_share');

    const payload = decodeSharePayload(pending);

    if (!payload) {
      return;
    }

    useSession.getState().loadFavoritePosition({
      fen: payload.fen,
      color: payload.color,
      moveSan: payload.move_san,
      cpLoss: payload.cp_loss,
      classification: payload.classification,
      moveNumber: payload.move_number,
      prevFen: payload.prev_fen,
      prevMoveUci: payload.prev_move_uci,
      uciPlayed: payload.uci_played,
      bestMoves: payload.best_moves,
      evalScore: payload.eval_before_white_pov,
    });
  }, [isAuthenticated]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // Public/legal screens keep their own chrome; everything else for a logged-in
  // user renders inside the AppShell (sidebar + content).
  const isPublicScreen = PUBLIC_SCREENS.includes(screen);
  const inShell = isAuthenticated && !isPublicScreen;

  // Drop the global background image/overlay on shell screens (kept on Landing).
  useEffect(() => {
    if (inShell) {
      document.documentElement.setAttribute('data-app-shell', '');
    } else {
      document.documentElement.removeAttribute('data-app-shell');
    }
  }, [inShell]);

  function handleAdminToggle(): void {
    setAdminView((v) => !v);
  }

  // The marketing/legal footer only belongs on the public-facing pages; the
  // in-app shell provides its own account controls in the sidebar.
  const showFooter = !inShell;

  const screenProps: ScreenProps = {
    isMobile,
    isAdmin,
    adminView,
    resetToken,
  };

  // ── Public screens (landing, legal, reset) render without the app shell. ──
  if (!inShell) {
    let publicContent: JSX.Element;

    if (screen === 'reset') {
      publicContent = <ResetPassword token={resetToken ?? ''} />;
    } else if (screen === 'terms') {
      publicContent = <Terms />;
    } else if (screen === 'privacy') {
      publicContent = <Privacy />;
    } else {
      // Unauthenticated visitors get the indexable marketing landing page.
      publicContent = <Landing />;
    }

    return (
      <div className={`app${!isAuthenticated ? ' app--landing' : ''}`}>
        <ErrorBanner />

        <main className={`app__main${isMobile ? ' app__main--mobile' : ''}`}>
          {publicContent}
        </main>

        {showFooter && <Footer isMobile={isMobile} />}
      </div>
    );
  }

  // ── Authenticated in-app screens render inside the AppShell. ──
  return (
    <div className="app app--shell">
      <ErrorBanner />

      <AppShell
        isMobile={isMobile}
        isAdmin={isAdmin}
        adminView={adminView}
        onAdminToggle={handleAdminToggle}
      >
        {renderScreen(screen, screenProps)}
      </AppShell>
    </div>
  );
}

export default App;
