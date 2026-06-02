/** App entry point — routes to the active screen based on session and auth state. */

import { useEffect } from 'react';
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
import './App.css';

function renderScreen(screen: Screen, isAuthenticated: boolean): JSX.Element {
  if (!isAuthenticated) {
    return <Login />;
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
  const getNamespace = useAuth((s) => s.getNamespace);

  const isAuthenticated = username !== undefined || isGuest;

  // On first mount, reload user-namespaced stores if a session was already stored.
  useEffect(() => {
    if (isAuthenticated) {
      const ns = getNamespace();
      useSettings.getState().reloadForUser(ns);
      useFavorites.getState().reloadForUser(ns);
      useReviewed.getState().reloadForUser(ns);
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
        {renderScreen(screen, isAuthenticated)}
      </main>
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
