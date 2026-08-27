/**
 * The controller. Wires the timer state machine to the audio path, the
 * computer-audio share, and the shared countdown badge.
 *
 * The one invariant that matters here: every async continuation started by a
 * run captures that run's id and checks it is still current before touching
 * anything. Without it, restarting a few seconds after the chime lets the
 * previous run's teardown close the new run's share.
 */
import * as audio from './audio';
import * as consent from './consent';
import * as indicator from './indicator';
import * as share from './share';
import { Timer } from './timer';
import { formatDuration } from './format';
import {
  configure,
  mayShareAudio,
  meetingLabel,
  onShareChanged,
  onVisibilityRestored,
  promptShareWithSound,
  OFFLINE_ENV,
  type ZoomEnv,
} from './zoom';
import { mount, render, type ViewModel } from './ui';

/** Safety net: if source.onended never fires, the share must still close. */
const WATCHDOG_MARGIN_MS = 4000;

let env: ZoomEnv = OFFLINE_ENV;
let label = 'Timer';
let shareOpen = false;
let lastOutcome: string | null = null;

const timer = new Timer();

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;

  mount(root, {
    onStart: (durationMs) => void startRun(durationMs),
    onRestart: () => void startRun(timer.snapshot().lastDurationMs),
    onPause: () => {
      timer.pause();
      void indicator.remove();
    },
    onResume: () => {
      timer.resume();
      void startIndicator(timer.snapshot().remainingMs);
    },
    onReset: () => void abandonRun(),
    onExtend: (ms) => {
      if (timer.extend(ms)) void indicator.extend(Math.round(ms / 1000));
    },
    onPromptShare: () => void promptShareWithSound(),
    onAcknowledgeDisclosure: () => {
      consent.acknowledge();
      paint();
    },
    onPreviewChime: () => void previewChime(),
  });

  timer.onChange(() => paint());
  timer.onPrearm((event) => void fire(event.runId, event.leadMs));
  paint();

  // Decode the chime before anything else so there is no latency at zero.
  audio.prepare().catch((error) => console.warn('chime decode failed', error));

  env = await configure();
  share.setSupported(mayShareAudio(env));
  share.setMyUUID(env.participantUUID);
  indicator.setSupported(env.canUseIndicator);

  if (env.inMeeting) {
    const topic = await meetingLabel();
    if (topic) label = topic.slice(0, 24);
    onShareChanged(share.noteScreenShare, share.noteAudioShare);
  }

  onVisibilityRestored(() => {
    // A hidden webview gets its timers throttled hard; the run may already
    // be due, so recompute rather than waiting for the next tick.
    timer.syncNow();
    paint();
  });

  // The badge is rendered by the Zoom client, so it would outlive this page.
  window.addEventListener('beforeunload', () => {
    void indicator.remove();
    if (share.isOpenByUs()) void share.stop();
  });

  paint();
}

async function startRun(durationMs: number): Promise<void> {
  if (timer.isBusy() || durationMs <= 0) return;
  // The UI hides the chooser until the notice is answered; this is the guard
  // on the path itself, for the moment between boot and config() resolving.
  if (disclosureNeeded()) return;

  // Tear down anything the previous run left behind before re-arming.
  audio.stop();
  await share.stop();
  shareOpen = false;
  await indicator.remove();
  lastOutcome = null;

  // This click is the user gesture browsers require before audio may play.
  await audio.unlock().catch(() => undefined);

  timer.start(durationMs);
  await startIndicator(durationMs);
  paint();
}

/** Play the chime locally. Deliberately never opens a share. */
async function previewChime(): Promise<void> {
  await audio.unlock().catch(() => undefined);
  audio.schedule(0, () => undefined);
}

/**
 * True while an audio share is possible and the user has not yet been told
 * what one does. Not asked on clients that cannot share audio: a warning
 * about something that cannot happen is just noise.
 */
function disclosureNeeded(): boolean {
  return mayShareAudio(env) && !consent.isAcknowledged();
}

async function startIndicator(remainingMs: number): Promise<void> {
  const seconds = Math.max(1, Math.round(remainingMs / 1000));
  await indicator.start(label, seconds);
  paint();
}

async function abandonRun(): Promise<void> {
  audio.stop();
  timer.reset();
  shareOpen = false;
  lastOutcome = null;
  await share.stop();
  await indicator.remove();
  paint();
}

/**
 * The firing sequence: open the share, schedule the chime on the audio
 * clock, then close the share behind it.
 */
async function fire(runId: number, leadMs: number): Promise<void> {
  const stillCurrent = (): boolean => timer.snapshot().runId === runId;

  const outcome = await share.start();
  if (!stillCurrent()) {
    // Reset or restart happened while the share was opening.
    if (outcome.openedByUs) await share.stop();
    return;
  }

  shareOpen = outcome.openedByUs;
  lastOutcome = outcome.audible ? null : outcome.reason;
  paint();

  let settled = false;
  const finish = (): void => {
    if (settled || !stillCurrent()) return;
    settled = true;
    clearTimeout(watchdog);
    void teardown(runId);
  };

  // onended is not a guarantee, so a watchdog closes the share regardless.
  const watchdog = setTimeout(finish, leadMs + audio.chimeDurationMs() + WATCHDOG_MARGIN_MS);

  audio.schedule(leadMs, finish);
}

async function teardown(runId: number): Promise<void> {
  await share.stop();
  if (timer.snapshot().runId !== runId) return;
  shareOpen = false;
  await indicator.remove();
  timer.markFinished(runId);
  paint();
}

function paint(): void {
  const snapshot = timer.snapshot();
  const advisory = snapshot.state === 'firing' || snapshot.state === 'finished'
    ? null
    : share.foreseenProblem();

  const atRest = snapshot.state === 'idle' || snapshot.state === 'finished';

  const view: ViewModel = {
    snapshot,
    sharedAudioAvailable: mayShareAudio(env) && advisory === null,
    sharedCountdownAvailable: env.canUseIndicator,
    shareOpen,
    advisory,
    advisoryHasPrompt: Boolean(advisory && advisory.includes('Share sound')),
    lastOutcome,
    needsAudioDisclosure: atRest && disclosureNeeded(),
    contextNote: contextNote(),
  };
  render(view);
}

function contextNote(): string {
  if (!env.inZoom) return 'Running outside Zoom — local timer only';
  if (!env.inMeeting) return 'Open this in a meeting to share the countdown';
  const parts: string[] = [label];
  if (timer.snapshot().state === 'idle') parts.push(`${formatDuration(timer.snapshot().lastDurationMs)} last used`);
  return parts.join(' · ');
}

// Repaint on a slow cadence so "Finished 2m ago" stays honest even when the
// timer itself has stopped ticking.
setInterval(() => {
  if (timer.snapshot().state === 'finished') paint();
}, 5000);

void boot();
