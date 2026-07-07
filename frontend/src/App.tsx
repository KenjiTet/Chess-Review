/** App entry point — routes to the active screen based on session and auth state. */

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import useSession from './hooks/useSession';
import type { Screen } from './hooks/useSession';
import { decodeSharePayload } from './utils/sharePosition';
import { ApiError, confirmEmail } from './api/client';
import useSettings from './hooks/useSettings';
import useAuth from './hooks/useAuth';
import useFavorites from './hooks/useFavorites';
import useReviewed from './hooks/useReviewed';
import useIsMobile from './hooks/useIsMobile';
import ErrorBanner from './components/ErrorBanner/ErrorBanner';
import ConfirmEmailBanner from './components/ConfirmEmailBanner/ConfirmEmailBanner';
import Footer from './components/Footer/Footer';
import Landing from './components/Landing/Landing';
import SessionSetup from './components/SessionSetup/SessionSetup';
import Loading from './components/Loading/Loading';
import Trainer from './components/Trainer/Trainer';
import Admin from './components/Admin/Admin';
import Settings from './components/Settings/Settings';
import Terms from './components/Legal/Terms';
import Privacy from './components/Legal/Privacy';
import ResetPassword from './components/ResetPassword/ResetPassword';
import './App.css';

interface ScreenProps {
  isMobile: boolean;
  isAdmin: boolean;
  adminView: boolean;
  onAdminToggle: () => void;
  resetToken: string | undefined;
}

function renderScreen(screen: Screen, isAuthenticated: boolean, props: ScreenProps): JSX.Element {
  const { isMobile, isAdmin, adminView, onAdminToggle, resetToken } = props;

  // Public screens — reachable with or without authentication (email links + footer).
  if (screen === 'reset') {
    return <ResetPassword token={resetToken ?? ''} />;
  }

  if (screen === 'terms') {
    return <Terms />;
  }

  if (screen === 'privacy') {
    return <Privacy />;
  }

  if (!isAuthenticated) {
    // Unauthenticated visitors get the indexable marketing landing page, which
    // embeds the login/guest form as its call-to-action.
    return <Landing />;
  }

  if (adminView && isAdmin) {
    return <Admin />;
  }

  if (screen === 'settings') {
    return <Settings />;
  }

  if (screen === 'setup') {
    return (
      <SessionSetup
        isMobile={isMobile}
        isAdmin={isAdmin}
        adminView={adminView}
        onAdminToggle={onAdminToggle}
      />
    );
  }

  if (screen === 'loading') {
    return <Loading />;
  }

  return <Trainer isMobile={isMobile} />;
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
  const [confirmNotice, setConfirmNotice] = useState<string | undefined>(undefined);

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

    if (confirmToken) {
      stripParam('confirm');
      void confirmEmail(confirmToken)
        .then((res) => {
          setConfirmNotice(res.message);
          // Clear the confirm-email banner immediately for a logged-in user.
          useAuth.getState().setEmailVerified(true);
        })
        .catch((err: unknown) => {
          const msg = err instanceof ApiError ? err.message : 'Email confirmation failed.';
          setConfirmNotice(msg);
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

  function handleAdminToggle(): void {
    setAdminView((v) => !v);
  }

  // The footer sits at the bottom of the page, but the full-bleed trainer, the
  // loading screen, and the admin dashboard need the whole viewport, so hide it there.
  const inAdminView = adminView && isAdmin;
  const showFooter = screen !== 'trainer' && screen !== 'loading' && !inAdminView;

  const screenProps: ScreenProps = {
    isMobile,
    isAdmin,
    adminView,
    onAdminToggle: handleAdminToggle,
    resetToken,
  };

  return (
    <div className={`app${!isAuthenticated ? ' app--landing' : ''}`}>
      <ErrorBanner />

      {/* One-off email-confirmation result notice (from a ?confirm= link). */}
      {confirmNotice && (
        <div className="app__confirm-notice" role="status">
          <span>{confirmNotice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setConfirmNotice(undefined)}>
            ✕
          </button>
        </div>
      )}

      {isAuthenticated && <ConfirmEmailBanner />}

      <main className={`app__main${isMobile ? ' app__main--mobile' : ''}`}>
        {renderScreen(screen, isAuthenticated, screenProps)}
      </main>

      {showFooter && <Footer />}

      {/* Fixed floating buttons — hidden on mobile (controls move into profile settings) */}
      {!isMobile && isAdmin && isAuthenticated && (
        <button
          className="admin-toggle"
          type="button"
          onClick={handleAdminToggle}
          title={adminView ? 'Back to app' : 'Admin dashboard'}
        >
          {adminView ? '⬅' : '⚙'}
        </button>
      )}
    </div>
  );
}

export default App;
