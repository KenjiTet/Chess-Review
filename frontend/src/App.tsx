/** App entry point — routes to the active screen based on session and auth state. */

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import useSession from './hooks/useSession';
import type { Screen } from './hooks/useSession';
import useSettings from './hooks/useSettings';
import useAuth from './hooks/useAuth';
import useFavorites from './hooks/useFavorites';
import useReviewed from './hooks/useReviewed';
import ErrorBanner from './components/ErrorBanner/ErrorBanner';
import Login from './components/Login/Login';
import SessionSetup from './components/SessionSetup/SessionSetup';
import Loading from './components/Loading/Loading';
import Trainer from './components/Trainer/Trainer';
import Admin from './components/Admin/Admin';
import './App.css';

function renderScreen(screen: Screen, isAuthenticated: boolean, isAdmin: boolean, adminView: boolean): JSX.Element {
  if (!isAuthenticated) {
    return <Login />;
  }

  if (adminView && isAdmin) {
    return <Admin />;
  }

  if (screen === 'setup') {
    return <SessionSetup />;
  }

  if (screen === 'loading') {
    return <Loading />;
  }

  return <Trainer />;
}

function App(): JSX.Element {
  const screen = useSession((s) => s.screen);
  const darkMode = useSettings((s) => s.darkMode);
  const setDarkMode = useSettings((s) => s.setDarkMode);
  const username = useAuth((s) => s.username);
  const isGuest = useAuth((s) => s.isGuest);
  const isAdmin = useAuth((s) => s.isAdmin);
  const getNamespace = useAuth((s) => s.getNamespace);
  const [adminView, setAdminView] = useState<boolean>(false);

  const isAuthenticated = username !== undefined || isGuest;

  // On first mount, reload user-namespaced stores if a session was already stored.
  useEffect(() => {
    if (isAuthenticated) {
      const ns = getNamespace();
      useSettings.getState().reloadForUser(ns);
      useFavorites.getState().reloadForUser(ns);

      // Reviewed games are stored per-user in the DB; guests have none.
      if (!isGuest) {
        void useReviewed.getState().loadFromServer();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  function handleThemeToggle(): void {
    setDarkMode(!darkMode);
  }

  return (
    <div className="app">
      <ErrorBanner />
      <main className="app__main">
        {renderScreen(screen, isAuthenticated, isAdmin, adminView)}
      </main>
      {isAdmin && isAuthenticated && (
        <button
          className="admin-toggle"
          type="button"
          onClick={() => setAdminView((v) => !v)}
          title={adminView ? 'Back to app' : 'Admin dashboard'}
        >
          {adminView ? '⬅' : '⚙'}
        </button>
      )}
      <button
        className="theme-toggle"
        type="button"
        onClick={handleThemeToggle}
        title="Toggle theme"
      >
        {darkMode ? '☼' : '☾'}
      </button>
    </div>
  );
}

export default App;
