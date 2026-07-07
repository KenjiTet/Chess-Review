/** Global footer — legal links, contact email, and app version.
 *
 * Pinned to the bottom of the shell content on menu pages (and shown at the end
 * of the public pages). Legal links navigate to the static Terms/Privacy
 * screens via the session store; account actions live in the sidebar.
 */

import type { JSX } from 'react';
import useSession from '../../hooks/useSession';
import './Footer.css';

// Injected at build time from package.json via vite.config.ts.
const APP_VERSION: string = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '0.0.0';
const CONTACT_EMAIL = 'contact@blunderdrill.com';

interface FooterProps {
  // On mobile the version is dropped and the links compress onto one line.
  isMobile?: boolean;
}

function Footer({ isMobile = false }: FooterProps): JSX.Element {
  const setScreen = useSession((s) => s.setScreen);

  return (
    <footer className={`footer${isMobile ? ' footer--mobile' : ''}`}>
      <div className="footer__inner">
        {/* Contact email, then legal links */}
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

        {/* Version — hidden on mobile to save horizontal space. */}
        {!isMobile && <span className="footer__version">v{APP_VERSION}</span>}
      </div>
    </footer>
  );
}

export default Footer;
