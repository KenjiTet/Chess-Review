/** Chess sound effects, played through the Web Audio API. */

import moveSoundUrl from '../sounds/Move.mp3';
import captureSoundUrl from '../sounds/Capture.mp3';
import checkSoundUrl from '../sounds/Check.mp3';
import checkmateSoundUrl from '../sounds/Checkmate.mp3';

// HTMLAudioElement.play() is treated as a *media* stream on mobile browsers, so
// it grabs the audio focus and pauses background apps (e.g. Spotify) on every
// move. The Web Audio API plays short SFX as game/ambient audio instead, which
// does not interrupt other media playback.

/** The set of available sound effects. */
export type SoundName = 'move' | 'capture' | 'check' | 'checkmate';

const SOUND_URLS: Record<SoundName, string> = {
  move: moveSoundUrl,
  capture: captureSoundUrl,
  check: checkSoundUrl,
  checkmate: checkmateSoundUrl,
};

// Lazily created, shared across all plays — a single context avoids exhausting
// the browser's per-page AudioContext limit.
let audioContext: AudioContext | undefined;
// Each sound is decoded once and cached for reuse.
const buffers: Partial<Record<SoundName, AudioBuffer>> = {};
// In-flight decodes, so a sound is never fetched/decoded more than once.
const decodePromises: Partial<Record<SoundName, Promise<void>>> = {};

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

/** Fetch and decode a sound into a reusable AudioBuffer. */
function ensureBuffer(context: AudioContext, name: SoundName): Promise<void> {
  if (decodePromises[name] === undefined) {
    decodePromises[name] = fetch(SOUND_URLS[name])
      .then((res) => res.arrayBuffer())
      .then((data) => context.decodeAudioData(data))
      .then((buffer) => {
        buffers[name] = buffer;
      })
      .catch((err: unknown) => {
        // Allow a later play to retry the decode.
        decodePromises[name] = undefined;
        console.warn(`[sounds] ${name} sound decode failed:`, err);
      });
  }

  return decodePromises[name];
}

/** Play an already-decoded buffer through the shared context. */
function playBuffer(context: AudioContext, name: SoundName): void {
  const buffer = buffers[name];
  if (buffer === undefined) {
    return;
  }

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start(0);
}

/** Play one of the chess sound effects. */
export function playSound(name: SoundName): void {
  const context = getContext();
  if (context === undefined) {
    return;
  }

  // Browsers start the context suspended until a user gesture — a move is a
  // gesture, so resume here is allowed and keeps later plays instant.
  if (context.state === 'suspended') {
    context.resume().catch(() => {});
  }

  if (buffers[name] !== undefined) {
    playBuffer(context, name);
    return;
  }

  ensureBuffer(context, name).then(() => {
    playBuffer(context, name);
  });
}

/** Play the plain piece-placement sound. */
export function playMoveSound(): void {
  playSound('move');
}

/**
 * Pick and play the sound that best describes a move's outcome.
 * Priority: checkmate > check > capture > plain move.
 */
export function playMoveOutcome(outcome: { captured: boolean; check: boolean; checkmate: boolean }): void {
  if (outcome.checkmate) {
    playSound('checkmate');
    return;
  }

  if (outcome.check) {
    playSound('check');
    return;
  }

  if (outcome.captured) {
    playSound('capture');
    return;
  }

  playSound('move');
}
