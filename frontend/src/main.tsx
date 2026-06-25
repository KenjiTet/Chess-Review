import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { setTokenProvider } from './api/client'
import useAuth from './hooks/useAuth'

// Register the auth store's token getter so all API calls include the JWT.
setTokenProvider(() => useAuth.getState().getToken());

// Register the service worker. With registerType 'autoUpdate', a new deploy is
// picked up automatically; reload once the fresh worker is active so the
// home-screen app always shows the latest version.
registerSW({
  onNeedRefresh() {
    window.location.reload();
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
