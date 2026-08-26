/**
 * Computer audio share -- how the chime reaches the meeting.
 *
 * shareComputerAudio pipes *all* system audio into the meeting for as long
 * as it runs, so the share window is kept as short as the chime: opened
 * about a second before zero, closed the moment playback ends.
 *
 * Every start and stop is serialized through one promise chain. Without
 * that, a fast restart can call start() while the previous stop() is still
 * in flight, and Zoom answers 10132.
 */
import zoomSdk from '@zoom/appssdk';
import { toZoomFailure } from './errors';

export interface ShareOutcome {
  /** Is the chime going to reach the meeting? */
  audible: boolean;
  /** Did *we* open the share? If not, we must not close it. */
  openedByUs: boolean;
  /** Short, user-facing explanation when audible is false. */
  reason: string;
}

/** Zoom's documented refusals for shareComputerAudio. */
const DISABLED_IN_MEETING = 10129;
const ALREADY_STARTED = 10132;
const MUST_STOP_ONGOING = 10137;

let supported = false;
let chain: Promise<unknown> = Promise.resolve();
let openedByUs = false;

/** Tracked from onShareScreen / onShareComputerAudio, keyed to our own UUID. */
const world = {
  myUUID: '',
  iAmSharingScreen: false,
  iAmSharingWithSound: false,
  someoneElseSharing: false,
};

export function setSupported(value: boolean): void {
  supported = value;
}

export function setMyUUID(uuid: string): void {
  world.myUUID = uuid;
}

export function noteScreenShare(participantUUID: string, action: 'start' | 'stop', withSound: boolean): void {
  const isMe = participantUUID === world.myUUID;
  if (isMe) {
    world.iAmSharingScreen = action === 'start';
    world.iAmSharingWithSound = action === 'start' && withSound;
  } else {
    world.someoneElseSharing = action === 'start';
  }
}

export function noteAudioShare(participantUUID: string, action: 'start' | 'stop'): void {
  if (participantUUID === world.myUUID) {
    world.iAmSharingWithSound = action === 'start';
  } else if (action === 'start') {
    world.someoneElseSharing = true;
  }
}

/**
 * What we can tell the user *before* they start a timer, rather than
 * discovering it at zero. Returns null when the chime should be audible.
 */
export function foreseenProblem(): string | null {
  if (!supported) return 'This client cannot share audio, so only you will hear the chime.';
  if (world.iAmSharingWithSound) return null; // Already flowing -- best case.
  if (world.iAmSharingScreen) {
    return 'You are sharing without sound. Turn on "Share sound" and everyone will hear the chime.';
  }
  if (world.someoneElseSharing) {
    return 'Someone else is sharing, so only you may hear the chime. Everyone will still see the countdown.';
  }
  return null;
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  // Keep the chain alive even when a link rejects.
  chain = next.catch(() => undefined);
  return next;
}

export function start(): Promise<ShareOutcome> {
  return enqueue(async () => {
    if (!supported) {
      return { audible: false, openedByUs: false, reason: 'Audio share is not available on this client.' };
    }

    // If our system audio is already going into the meeting, the chime is
    // already audible and calling start would only earn a 10132.
    if (world.iAmSharingWithSound) {
      openedByUs = false;
      return { audible: true, openedByUs: false, reason: '' };
    }

    try {
      await zoomSdk.shareComputerAudio({ action: 'start', mode: 'mono' });
      openedByUs = true;
      return { audible: true, openedByUs: true, reason: '' };
    } catch (error) {
      const failure = toZoomFailure(error);
      openedByUs = false;

      if (failure.code === ALREADY_STARTED) {
        // A share we did not open. Audible, but not ours to close.
        return { audible: true, openedByUs: false, reason: '' };
      }
      if (failure.code === DISABLED_IN_MEETING) {
        return { audible: false, openedByUs: false, reason: 'Computer audio sharing is disabled in this meeting.' };
      }
      if (failure.code === MUST_STOP_ONGOING) {
        return {
          audible: false,
          openedByUs: false,
          reason: 'Screen sharing is using the audio channel, so only you heard the chime.',
        };
      }
      return { audible: false, openedByUs: false, reason: 'Could not share audio, so only you heard the chime.' };
    }
  });
}

/** Close the share, but only if we were the ones who opened it. */
export function stop(): Promise<void> {
  return enqueue(async () => {
    if (!supported || !openedByUs) return;
    openedByUs = false;
    try {
      await zoomSdk.shareComputerAudio({ action: 'stop' });
    } catch (error) {
      console.warn('shareComputerAudio stop failed', toZoomFailure(error));
    }
  });
}

export function isOpenByUs(): boolean {
  return openedByUs;
}
