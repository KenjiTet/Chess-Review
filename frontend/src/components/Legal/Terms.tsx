/** Terms of Use — placeholder content, to be finalised before public launch. */

import type { JSX } from 'react';
import LegalPage from './LegalPage';

function Terms(): JSX.Element {
  return (
    <LegalPage title="Terms of Use">
      <p className="legal__updated">Last updated: 7 July 2026</p>

      <h2>1. Acceptance of terms</h2>
      <p>
        By using BlunderDrill you agree to these Terms of Use. If you do not agree, please do not use
        the service. This is placeholder text and will be replaced with the final terms before launch.
      </p>

      <h2>2. The service</h2>
      <p>
        BlunderDrill fetches your publicly available games from Chess.com and Lichess, analyses them,
        and presents your blunders as training positions. The service is provided on an “as is” basis
        without warranties of any kind.
      </p>

      <h2>3. Accounts</h2>
      <p>
        You are responsible for maintaining the confidentiality of your account credentials and for all
        activity that occurs under your account. You must provide a valid email address to register.
      </p>

      <h2>4. Acceptable use</h2>
      <p>
        You agree not to misuse the service, attempt to disrupt it, or access it using automated means
        beyond what is reasonable for personal training use.
      </p>

      <h2>5. Contact</h2>
      <p>
        Questions about these terms can be sent to{' '}
        <a href="mailto:contact@blunderdrill.com">contact@blunderdrill.com</a>.
      </p>
    </LegalPage>
  );
}

export default Terms;
