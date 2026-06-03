/** Reactive hook that returns true when the viewport width is ≤ 768 px. */

import { useEffect, useState } from 'react';

const MOBILE_BREAKPOINT = 768;

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(
    () => window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);

    function handler(e: MediaQueryListEvent): void {
      setIsMobile(e.matches);
    }

    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

export default useIsMobile;
