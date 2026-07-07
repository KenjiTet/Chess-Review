/** Privacy Policy — placeholder content, to be finalised before public launch. */

import type { JSX } from 'react';
import LegalPage from './LegalPage';

function Privacy(): JSX.Element {
  return (
    <LegalPage title="Privacy Policy">
      <p className="legal__updated">Last updated: 7 July 2026</p>

      <h2>1. Overview</h2>
      <p>
        This Privacy Policy explains what data BlunderDrill collects and how it is used. This is
        placeholder text and will be replaced with the final policy before launch.
      </p>

      <h2>2. Data we collect</h2>
      <p>
        We store your email address, a hashed password (never in plain text), and the Chess.com or
        Lichess handle you link. We also cache the analysis of your public games to power your training
        and statistics.
      </p>

      <h2>3. Google sign-in</h2>
      <p>
        If you sign in with Google, we receive your verified email address from Google. We do not
        receive your Google password.
      </p>

      <h2>4. How we use your data</h2>
      <p>
        Your data is used solely to operate the service — authenticating you, fetching and analysing
        your games, and displaying your statistics. We do not sell your data.
      </p>

      <h2>5. Deleting your data</h2>
      <p>
        You can permanently delete your account and all associated data at any time from Account
        Settings.
      </p>

      <h2>6. Contact</h2>
      <p>
        Privacy questions can be sent to{' '}
        <a href="mailto:contact@blunderdrill.com">contact@blunderdrill.com</a>.
      </p>
    </LegalPage>
  );
}

export default Privacy;
