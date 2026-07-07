/** Google Identity Services sign-in button.
 *
 * Loads the GIS script on demand, initialises it with VITE_GOOGLE_CLIENT_ID, and
 * renders Google's own button. On success it hands the returned ID token to the
 * parent. Renders nothing when no client id is configured (e.g. local dev without
 * Google set up), so the rest of the login screen still works.
 */

import { useEffect, useRef } from 'react';
import type { JSX } from 'react';

// Minimal typing for just the slice of the GIS API we use.
interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdApi {
  initialize: (config: { client_id: string; callback: (response: GoogleCredentialResponse) => void }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void;
}

interface GoogleAccountsApi {
  id: GoogleIdApi;
}

declare global {
  interface Window {
    google?: { accounts: GoogleAccountsApi };
  }
}

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const CLIENT_ID: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

interface GoogleButtonProps {
  onCredential: (idToken: string) => void;
}

/** Load the GIS script once, resolving when window.google is available. */
function loadGisScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Already loaded — resolve immediately.
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }

    // Reuse an in-flight script tag if one already exists.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_SRC}"]`);

    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google sign-in.')));
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Failed to load Google sign-in.')));
    document.head.appendChild(script);
  });
}

function GoogleButton(props: GoogleButtonProps): JSX.Element | undefined {
  const { onCredential } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Without a configured client id there is nothing to render.
    if (!CLIENT_ID) {
      return;
    }

    let cancelled = false;

    async function setup(): Promise<void> {
      try {
        await loadGisScript();
      } catch {
        // Silent: the button just won't appear if Google's script is blocked.
        return;
      }

      if (cancelled || !containerRef.current || !window.google) {
        return;
      }

      window.google.accounts.id.initialize({
        client_id: CLIENT_ID as string,
        callback: (response: GoogleCredentialResponse) => onCredential(response.credential),
      });

      window.google.accounts.id.renderButton(containerRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        width: 320,
      });
    }

    void setup();

    return () => {
      cancelled = true;
    };
  }, [onCredential]);

  // Hide the whole block when Google sign-in isn't configured.
  if (!CLIENT_ID) {
    return undefined;
  }

  return <div className="login__google" ref={containerRef} />;
}

export default GoogleButton;
