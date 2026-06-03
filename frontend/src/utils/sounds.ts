/** Chess move sound using the bundled MP3 asset. */

import moveSoundUrl from '../sounds/Move.mp3';

/** Play the piece-placement sound. */
export function playMoveSound(): void {
  // Create a fresh Audio instance each time — avoids state issues when moves
  // are played in rapid succession before the previous sound finishes.
  const audio = new Audio(moveSoundUrl);
  audio.play().catch((err: unknown) => {
    console.warn('[sounds] playMoveSound failed:', err);
  });
}
