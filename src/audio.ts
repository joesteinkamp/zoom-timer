/**
 * Web Audio for the chime.
 *
 * The clip is a build asset, so it is fetched and decoded once at boot and
 * the AudioBuffer is held for the session -- there is never decode latency
 * at zero. Only *playback* needs a user gesture, which the Start button
 * supplies via unlock().
 *
 * Scheduling goes through AudioContext's own high-resolution clock rather
 * than setTimeout, which is only accurate to tens of milliseconds.
 */
import chimeUrl from './assets/chime.wav';

let ctx: AudioContext | null = null;
let buffer: AudioBuffer | null = null;
let current: AudioBufferSourceNode | null = null;

/** Floor on scheduling lead when a throttled webview wakes up late. */
const MIN_LEAD_SEC = 0.12;

function context(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** Fetch and decode the chime. Safe to call before any user interaction. */
export async function prepare(): Promise<void> {
  if (buffer) return;
  const response = await fetch(chimeUrl);
  if (!response.ok) throw new Error(`chime fetch failed: ${response.status}`);
  const bytes = await response.arrayBuffer();
  buffer = await context().decodeAudioData(bytes);
}

/**
 * Resume the AudioContext. Must be called from inside a user gesture --
 * browsers will not start audio otherwise.
 */
export async function unlock(): Promise<void> {
  const audio = context();
  if (audio.state === 'suspended') await audio.resume();
}

export function isReady(): boolean {
  return buffer !== null;
}

export function chimeDurationMs(): number {
  return buffer ? buffer.duration * 1000 : 0;
}

/**
 * Schedule the chime `leadMs` from now on the audio clock.
 * `onEnded` fires when playback completes -- or is dropped if the source is
 * superseded by a later call to schedule() or stop().
 */
export function schedule(leadMs: number, onEnded: () => void): void {
  if (!buffer) {
    onEnded();
    return;
  }
  stop();

  const audio = context();
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  source.onended = () => {
    if (current === source) current = null;
    onEnded();
  };
  current = source;
  source.start(audio.currentTime + Math.max(leadMs / 1000, MIN_LEAD_SEC));
}

/** Stop any scheduled or playing chime without firing its onEnded. */
export function stop(): void {
  if (!current) return;
  const source = current;
  current = null;
  source.onended = null;
  try {
    source.stop();
  } catch {
    /* Already stopped or never started -- nothing to unwind. */
  }
  source.disconnect();
}
