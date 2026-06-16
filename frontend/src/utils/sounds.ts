/** Chess move sound using the bundled MP3 asset. */

import moveSoundUrl from '../sounds/Move.mp3';

// HTMLAudioElement.play() is treated as a *media* stream on mobile browsers, so
// it grabs the audio focus and pauses background apps (e.g. Spotify) on every
// move. The Web Audio API plays short SFX as game/ambient audio instead, which
// does not interrupt other media playback.

// Lazily created, shared across all plays — a single context avoids exhausting
// the browser's per-page AudioContext limit.
let audioContext: AudioContext | undefined;
// Decoded once and reused for every play.
let moveBuffer: AudioBuffer | undefined;
// Guards against kicking off the decode more than once.
let decodePromise: Promise<void> | undefined;

/** Resolve the AudioContext, creating it on first use. */
function getContext(): AudioContext | undefined {
  if (audioContext === undefined) {
    // Safari still exposes the prefixed constructor only.
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) {
      return undefined;
    }
    audioContext = new Ctor();
  }

  return audioContext;
}

/** Fetch and decode the move sound into a reusable AudioBuffer. */
function ensureBuffer(context: AudioContext): Promise<void> {
  if (decodePromise === undefined) {
    decodePromise = fetch(moveSoundUrl)
      .then((res) => res.arrayBuffer())
      .then((data) => context.decodeAudioData(data))
      .then((buffer) => {
        moveBuffer = buffer;
      })
      .catch((err: unknown) => {
        // Allow a later play to retry the decode.
        decodePromise = undefined;
        console.warn('[sounds] move sound decode failed:', err);
      });
  }

  return decodePromise;
}

/** Play the decoded buffer through the shared context. */
function playBuffer(context: AudioContext): void {
  if (moveBuffer === undefined) {
    return;
  }

  const source = context.createBufferSource();
  source.buffer = moveBuffer;
  source.connect(context.destination);
  source.start(0);
}

/** Play the piece-placement sound. */
export function playMoveSound(): void {
  const context = getContext();
  if (context === undefined) {
    return;
  }

  // Browsers start the context suspended until a user gesture — a move is a
  // gesture, so resume here is allowed and keeps later plays instant.
  if (context.state === 'suspended') {
    context.resume().catch(() => {});
  }

  if (moveBuffer !== undefined) {
    playBuffer(context);
    return;
  }

  ensureBuffer(context).then(() => {
    playBuffer(context);
  });
}
