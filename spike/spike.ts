/**
 * M0 spike — the one experiment that has to happen before anything else is
 * worth building.
 *
 * Two questions to settle in a real meeting with a second participant:
 *
 *  1. Does shareComputerAudio actually put a tone into the meeting mix?
 *  2. Does the tone's loudness in the meeting track *your* system volume?
 *     Play it at full volume, have them report the level, drop to ~10% and
 *     play again. If it tracks, that is a design constraint, not a bug.
 */
import zoomSdk from '@zoom/appssdk';
import { toZoomFailure } from '../src/errors';

const TONE_SECONDS = 2;
const log: string[] = [];

let ctx: AudioContext | null = null;
let output: HTMLElement | null = null;

function note(message: string): void {
  const stamp = new Date().toISOString().slice(11, 23);
  log.unshift(`${stamp}  ${message}`);
  if (output) output.textContent = log.join('\n');
}

async function playTone(): Promise<void> {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') await ctx.resume();

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;

  // Ramp the envelope so the tone is unmistakable but not a click.
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.35, now + 0.02);
  gain.gain.setValueAtTime(0.35, now + TONE_SECONDS - 0.05);
  gain.gain.linearRampToValueAtTime(0, now + TONE_SECONDS);

  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + TONE_SECONDS);

  await new Promise<void>((resolve) => {
    osc.onended = () => resolve();
  });
  osc.disconnect();
  gain.disconnect();
}

async function shareAndPlay(): Promise<void> {
  note('shareComputerAudio start …');
  let opened = false;
  try {
    await zoomSdk.shareComputerAudio({ action: 'start', mode: 'mono' });
    opened = true;
    note('share opened');
  } catch (error) {
    const failure = toZoomFailure(error);
    note(`share REFUSED code=${failure.code ?? '?'} "${failure.message}"`);
    note('playing locally anyway so you can hear the fallback');
  }

  await playTone();
  note('tone finished');

  if (opened) {
    try {
      await zoomSdk.shareComputerAudio({ action: 'stop' });
      note('share closed');
    } catch (error) {
      note(`share stop failed: ${toZoomFailure(error).message}`);
    }
  }
}

async function boot(): Promise<void> {
  const root = document.getElementById('spike');
  if (!root) return;

  root.innerHTML = `
    <div class="masthead">
      <h1>M0 — Audio Share Spike</h1>
      <div class="sub" id="env">checking client …</div>
    </div>
    <div class="row wrap">
      <button class="primary" id="shared" type="button">Play 2s tone to the meeting</button>
      <button id="local" type="button">Play 2s tone locally only</button>
    </div>
    <div class="status">
      <div class="warn">
        Run this in a real meeting with a second participant. Ask them what they
        heard, then set your system volume to about 10% and play it again.
      </div>
    </div>
    <pre id="log" style="font-size:12px;white-space:pre-wrap;color:var(--ink-soft);margin:0"></pre>
  `;

  output = document.getElementById('log');
  const envLine = document.getElementById('env');

  document.getElementById('shared')?.addEventListener('click', () => void shareAndPlay());
  document.getElementById('local')?.addEventListener('click', () => {
    note('local tone');
    void playTone();
  });

  try {
    const config = await zoomSdk.config({
      version: '0.16',
      capabilities: ['shareComputerAudio', 'onShareComputerAudio', 'getRunningContext', 'getUserContext'],
    });
    const unsupported = config.unsupportedApis ?? [];
    if (envLine) {
      envLine.textContent =
        `${config.runningContext} · client ${config.clientVersion} · ` +
        (unsupported.includes('shareComputerAudio')
          ? 'shareComputerAudio UNSUPPORTED'
          : 'shareComputerAudio available');
    }
    note(`configured: ${config.runningContext}, client ${config.clientVersion}`);
    if (unsupported.length) note(`unsupported: ${unsupported.join(', ')}`);

    zoomSdk.onShareComputerAudio((event) => {
      note(`onShareComputerAudio ${event.action} by ${event.participantUUID.slice(0, 8)}…`);
    });
  } catch (error) {
    if (envLine) envLine.textContent = 'Zoom SDK unavailable — open this inside the Zoom client.';
    note(`config failed: ${toZoomFailure(error).message}`);
  }
}

void boot();
