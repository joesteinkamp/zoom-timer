/**
 * The shared countdown badge.
 *
 * setDynamicIndicator paints a live countdown next to your name in every
 * participant's client, rendered by Zoom rather than by this page. That has
 * two consequences worth remembering:
 *
 *  - It needs no share slot, so it works even when the audio share is
 *    refused. It is the reliable channel; audio is best-effort.
 *  - It outlives this webview. If the app is closed mid-run the badge would
 *    keep counting, so it is removed on teardown.
 */
import zoomSdk from '@zoom/appssdk';
import { toZoomFailure } from './errors';

let supported = false;
let active = false;

export function setSupported(value: boolean): void {
  supported = value;
}

export function isSupported(): boolean {
  return supported;
}

export function isActive(): boolean {
  return active;
}

/**
 * Start a countdown badge. Any existing badge is removed first: setting a
 * new indicator over a live one is not a clean replace.
 */
export async function start(label: string, seconds: number): Promise<void> {
  if (!supported) return;
  await remove();
  try {
    await zoomSdk.setDynamicIndicator({
      text: label,
      timer: {
        action: 'start',
        direction: 'down',
        start: seconds,
        // Zoom's own chime would collide with ours.
        withSound: false,
        // Counting negative would leave "-2:14" next to your name while you
        // line up the next timer. The panel carries the finished state.
        countNegativeAfterAlarm: false,
        showNotification: false,
      },
      backgroundColor: '#1F5AA8',
      textColor: '#FFFFFF',
    });
    active = true;
  } catch (error) {
    active = false;
    console.warn('setDynamicIndicator failed', toZoomFailure(error));
  }
}

/** Add time to the live badge. Only works on down-direction timers. */
export async function extend(seconds: number): Promise<void> {
  if (!supported || !active) return;
  try {
    await zoomSdk.extendDynamicIndicator({ extendDuration: seconds });
  } catch (error) {
    console.warn('extendDynamicIndicator failed', toZoomFailure(error));
  }
}

export async function remove(): Promise<void> {
  if (!supported || !active) return;
  active = false;
  try {
    await zoomSdk.removeDynamicIndicator();
  } catch (error) {
    console.warn('removeDynamicIndicator failed', toZoomFailure(error));
  }
}
