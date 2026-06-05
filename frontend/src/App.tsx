/** App entry point — routes to the active screen based on session and auth state. */

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import useSession from './hooks/useSession';
import type { Screen } from './hooks/useSession';
import { decodeSharePayload } from './utils/sharePosition';
import useSettings from './hooks/useSettings';
import useAuth from './hooks/useAuth';
import useFavorites from './hooks/useFavorites';
import useReviewed from './hooks/useReviewed';
import useIsMobile from './hooks/useIsMobile';
import ErrorBanner from './components/ErrorBanner/ErrorBanner';
import Login from './components/Login/Login';
import SessionSetup from './components/SessionSetup/SessionSetup';
import Loading from './components/Loading/Loading';
import Trainer from './components/Trainer/Trainer';
import Admin from './components/Admin/Admin';
import './App.css';

interface ScreenProps {
  isMobile: boolean;
  isAdmin: boolean;
  adminView: boolean;
  onAdminToggle: () => void;
}

function renderScreen(screen: Screen, isAuthenticated: boolean, props: ScreenProps): JSX.Element {
  const { isMobile, isAdmin, adminView, onAdminToggle } = props;

  if (!isAuthenticated) {
    return <Login />;
  }

  if (adminView && isAdmin) {
    return <Admin />;
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
  const setDarkMode = useSettings((s) => s.setDarkMode);
  const mobileOverride = useSettings((s) => s.mobileOverride);
  const toggleMobileOverride = useSettings((s) => s.toggleMobileOverride);
  const username = useAuth((s) => s.username);
  const isAdmin = useAuth((s) => s.isAdmin);
  const getNamespace = useAuth((s) => s.getNamespace);
  const [adminView, setAdminView] = useState<boolean>(false);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  function handleThemeToggle(): void {
    setDarkMode(!darkMode);
  }

  function handleAdminToggle(): void {
    setAdminView((v) => !v);
  }

  const screenProps: ScreenProps = {
    isMobile,
    isAdmin,
    adminView,
    onAdminToggle: handleAdminToggle,
  };

  return (
    <div className="app">
      <ErrorBanner />
      <main className={`app__main${isMobile ? ' app__main--mobile' : ''}`}>
        {renderScreen(screen, isAuthenticated, screenProps)}
      </main>

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
