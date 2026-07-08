import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { setTokenProvider } from './api/client'
import useAuth from './hooks/useAuth'

// Register the auth store's token getter so all API calls include the JWT.
setTokenProvider(() => useAuth.getState().getToken());

// Service worker (registerType 'autoUpdate'): a new deploy's worker installs
// and — thanks to skipWaiting + clientsClaim in the workbox config — activates
// and takes control of this page automatically. When that happens on a page
// that was ALREADY controlled by a worker, it means a newer version has taken
// over, so reload once to apply it. The controller check skips this on the very
// first visit (no prior worker), avoiding an extra reload on install.
let reloading = false;

if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) {
      return;
    }

    reloading = true;
    window.location.reload();
  });
}

registerSW({
  // Register as soon as the page loads rather than waiting for the load event.
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) {
      return;
    }

    // Poll for a new deployment so a hotfix rolls out within a minute instead
    // of waiting for the browser's periodic (~24h) service-worker update check.
    setInterval(() => {
      void registration.update();
    }, 60 * 1000);
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
