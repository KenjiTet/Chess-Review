/** Shared layout for the static legal pages (Terms, Privacy).
 *
 * Renders a titled article with a back link to the main app. Content is passed as
 * children so each page supplies its own copy.
 */

import type { JSX, ReactNode } from 'react';
import useSession from '../../hooks/useSession';
import './Legal.css';

interface LegalPageProps {
  title: string;
  children: ReactNode;
}

function LegalPage(props: LegalPageProps): JSX.Element {
  const { title, children } = props;
  const setScreen = useSession((s) => s.setScreen);

  return (
    <div className="legal">
      <div className="legal__card">
        <button type="button" className="legal__back" onClick={() => setScreen('setup')}>
          ← Back
        </button>
        <h1 className="legal__title">{title}</h1>
        <div className="legal__body">{children}</div>
      </div>
    </div>
  );
}

export default LegalPage;
