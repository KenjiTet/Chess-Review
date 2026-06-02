import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { setTokenProvider } from './api/client'
import useAuth from './hooks/useAuth'

// Register the auth store's token getter so all API calls include the JWT.
setTokenProvider(() => useAuth.getState().getToken());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
