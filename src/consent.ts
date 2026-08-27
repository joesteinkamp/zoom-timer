/**
 * The audio disclosure.
 *
 * Opening a computer-audio share puts *everything* audible on the machine
 * into the meeting for as long as it runs. That is a thing a person should
 * agree to knowingly rather than discover at zero, and Zoom requires express
 * consent for access of this kind before it happens.
 *
 * Shown once, and only where an audio share is actually possible -- telling
 * someone on a mobile client that their system audio will be shared would be
 * a warning about something that cannot occur.
 */
const KEY = 'zoom-timer:audio-disclosure';

/** Bump to re-ask everyone if what the app does with audio ever changes. */
export const DISCLOSURE_VERSION = '1';

let acknowledged = read();

export function isAcknowledged(): boolean {
  return acknowledged;
}

export function acknowledge(): void {
  acknowledged = true;
  try {
    localStorage.setItem(KEY, DISCLOSURE_VERSION);
  } catch {
    /* Private windows and blocked site data throw. The acknowledgement holds
       for this session; they will be asked again next time, which is the
       right way to fail. */
  }
}

/** Exposed for tests, which need to observe a fresh install. */
export function forget(): void {
  acknowledged = false;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* Nothing to unwind. */
  }
}

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === DISCLOSURE_VERSION;
  } catch {
    return false;
  }
}
