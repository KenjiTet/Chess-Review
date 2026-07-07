/** Global footer — user actions, legal links, and app version.
 *
 * Rendered once in the app shell on every screen. Legal links navigate to the
 * static Terms/Privacy screens via the session store.
 */

import type { JSX } from 'react';
import useSession from '../../hooks/useSession';
import useAuth from '../../hooks/useAuth';
import './Footer.css';

// Injected at build time from package.json via vite.config.ts.
const APP_VERSION: string = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '0.0.0';
const CONTACT_EMAIL = 'contact@blunderdrill.com';

function Footer(): JSX.Element {
  const setScreen = useSession((s) => s.setScreen);
  const logout = useAuth((s) => s.logout);
  const isGuest = useAuth((s) => s.isGuest);

  return (
    <footer className="footer">
      <div className="footer__inner">
        {/* Left: Settings and Logout buttons */}
        <div className="footer__actions">
          {!isGuest && (
            <button type="button" className="footer__btn" onClick={() => setScreen('settings')}>
              Settings
            </button>
          )}
          <button type="button" className="footer__btn" onClick={logout}>
            Log out
          </button>
        </div>

        {/* Center: Legal links and contact email */}
        <nav className="footer__links">
          <a className="footer__link" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          <button type="button" className="footer__link" onClick={() => setScreen('terms')}>
            Terms of Use
          </button>
          <button type="button" className="footer__link" onClick={() => setScreen('privacy')}>
            Privacy
          </button>
        </nav>

        {/* Right: Version */}
        <span className="footer__version">v{APP_VERSION}</span>
      </div>
    </footer>
  );
}

export default Footer;
