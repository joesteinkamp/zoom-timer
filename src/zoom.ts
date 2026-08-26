/**
 * Zoom Apps SDK bootstrap.
 *
 * Every API is opt-in twice: enabled in the Marketplace build flow, and
 * listed in config() here. config() answers with `unsupportedApis`, which is
 * how we feature-detect rather than assume -- shareComputerAudio needs
 * client 5.12.6+ and is desktop-only, dynamic indicators need 5.17.5+.
 */
import zoomSdk from '@zoom/appssdk';
import type { ConfigResponse, RunningContext } from '@zoom/appssdk';
import { toZoomFailure } from './errors';

const CAPABILITIES = [
  'getRunningContext',
  'getUserContext',
  'getMeetingContext',
  'getSupportedJsApis',
  'onRunningContextChange',
  'onAppVisibilityChange',
  'shareComputerAudio',
  'onShareComputerAudio',
  'onShareScreen',
  'promptShareScreen',
  'setDynamicIndicator',
  'removeDynamicIndicator',
  'extendDynamicIndicator',
  'expandApp',
] as const;

export interface ZoomEnv {
  /** False when the page is open in a plain browser rather than the client. */
  inZoom: boolean;
  runningContext: RunningContext | null;
  inMeeting: boolean;
  role: string;
  screenName: string;
  participantUUID: string;
  canShareAudio: boolean;
  canUseIndicator: boolean;
  clientVersion: string;
}

export const OFFLINE_ENV: ZoomEnv = {
  inZoom: false,
  runningContext: null,
  inMeeting: false,
  role: '',
  screenName: '',
  participantUUID: '',
  canShareAudio: false,
  canUseIndicator: false,
  clientVersion: '',
};

export async function configure(): Promise<ZoomEnv> {
  let config: ConfigResponse;
  try {
    config = await zoomSdk.config({
      version: '0.16',
      capabilities: [...CAPABILITIES],
    });
  } catch (error) {
    // Opened outside the Zoom client (a browser tab, or a client too old to
    // bridge). The timer still works; nothing shared does.
    console.info('Zoom SDK unavailable, running standalone', toZoomFailure(error));
    return OFFLINE_ENV;
  }

  const unsupported = new Set<string>(config.unsupportedApis ?? []);
  const context = config.runningContext;
  const inMeeting = context === 'inMeeting' || context === 'inWebinar';

  const env: ZoomEnv = {
    inZoom: true,
    runningContext: context,
    inMeeting,
    role: '',
    screenName: '',
    participantUUID: '',
    canShareAudio: inMeeting && !unsupported.has('shareComputerAudio'),
    canUseIndicator: inMeeting && !unsupported.has('setDynamicIndicator'),
    clientVersion: config.clientVersion ?? '',
  };

  if (inMeeting) {
    try {
      const user = await zoomSdk.getUserContext();
      env.role = user.role ?? '';
      env.screenName = user.screenName ?? '';
      env.participantUUID = user.participantUUID ?? '';
    } catch (error) {
      console.warn('getUserContext failed', toZoomFailure(error));
    }
  }

  return env;
}

/**
 * In a webinar, audio share is host / co-host / panelist only -- that is
 * Zoom's rule, not a policy of this app. In meetings anyone may start one.
 */
export function mayShareAudio(env: ZoomEnv): boolean {
  if (!env.canShareAudio) return false;
  if (env.runningContext !== 'inWebinar') return true;
  return env.role === 'host' || env.role === 'coHost' || env.role === 'panelist';
}

export async function meetingLabel(): Promise<string> {
  try {
    const meeting = await zoomSdk.getMeetingContext();
    return meeting.meetingTopic ?? '';
  } catch {
    return '';
  }
}

export function onVisibilityRestored(fn: () => void): void {
  // onAppVisibilityChange needs client 6.4.5+, so the DOM event is the
  // actual defense and this is the optimization.
  try {
    zoomSdk.onAppVisibilityChange((event) => {
      if (event.visible) fn();
    });
  } catch {
    /* Not supported on this client -- the listener below still covers us. */
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) fn();
  });
  window.addEventListener('focus', fn);
}

export function onShareChanged(
  onScreen: (uuid: string, action: 'start' | 'stop', withSound: boolean) => void,
  onAudio: (uuid: string, action: 'start' | 'stop') => void,
): void {
  try {
    zoomSdk.onShareScreen((event) => {
      onScreen(event.participantUUID, event.action, Boolean(event.withSound));
    });
  } catch {
    /* Event unsupported on this client. */
  }
  try {
    zoomSdk.onShareComputerAudio((event) => {
      onAudio(event.participantUUID, event.action);
    });
  } catch {
    /* Event unsupported on this client. */
  }
}

/** Offer to start a screen share with sound already enabled. */
export async function promptShareWithSound(): Promise<boolean> {
  try {
    await zoomSdk.promptShareScreen({ shareSound: true });
    return true;
  } catch (error) {
    console.warn('promptShareScreen failed', toZoomFailure(error));
    return false;
  }
}
