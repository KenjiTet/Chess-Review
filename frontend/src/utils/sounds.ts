/** Chess move sound using the bundled MP3 asset. */

const moveSoundUrl = new URL('../sounds/Move.mp3', import.meta.url).href;

let audioElement: HTMLAudioElement | null = null;

function getAudio(): HTMLAudioElement {
  if (!audioElement) {
    audioElement = new Audio(moveSoundUrl);
  }
  return audioElement;
}

/** Play the piece-placement sound. */
export function playMoveSound(): void {
  const audio = getAudio();
  audio.currentTime = 0;
  audio.play().catch(() => {});
}
