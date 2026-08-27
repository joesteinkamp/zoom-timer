/**
 * M0 spike — the experiment that has to happen before the rest is worth
 * trusting. It cannot be run outside the Zoom desktop client: the audio path
 * only exists there, and the second question needs a human on the other end.
 *
 * Two questions:
 *   1. Does shareComputerAudio actually put a tone into the meeting mix?
 *   2. Does the tone's loudness in the meeting track *your* system volume?
 *      If so, no amount of mastering fixes it and it is a documented
 *      limitation rather than a bug to chase.
 *
 * The page walks both, then prints a result block to paste back.
 */
import zoomSdk from '@zoom/appssdk';
import { toZoomFailure } from '../src/errors';

const TONE_SECONDS = 2;

interface Attempt {
  label: string;
  shareOpened: boolean;
  errorCode: number | null;
  errorMessage: string;
  openMs: number;
}

const attempts: Attempt[] = [];
const events: string[] = [];
let environment = 'not configured';
let ctx: AudioContext | null = null;

function note(message: string): void {
  const stamp = new Date().toISOString().slice(11, 23);
  events.unshift(`${stamp}  ${message}`);
  const log = document.getElementById('log');
  if (log) log.textContent = events.join('\n');
}

async function playTone(): Promise<void> {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') await ctx.resume();

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;

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

async function runAttempt(label: string): Promise<void> {
  note(`--- ${label} ---`);
  const started = performance.now();
  const attempt: Attempt = { label, shareOpened: false, errorCode: null, errorMessage: '', openMs: 0 };

  try {
    await zoomSdk.shareComputerAudio({ action: 'start', mode: 'mono' });
    attempt.shareOpened = true;
    attempt.openMs = Math.round(performance.now() - started);
    note(`share opened in ${attempt.openMs}ms`);
  } catch (error) {
    const failure = toZoomFailure(error);
    attempt.errorCode = failure.code;
    attempt.errorMessage = failure.message;
    note(`share REFUSED code=${failure.code ?? '?'} "${failure.message}" — playing locally so you hear the fallback`);
  }

  await playTone();
  note('tone finished');

  if (attempt.shareOpened) {
    try {
      await zoomSdk.shareComputerAudio({ action: 'stop' });
      note('share closed');
    } catch (error) {
      note(`share stop FAILED: ${toZoomFailure(error).message}`);
    }
  }

  attempts.push(attempt);
  refreshResult();
}

function answer(name: string): string {
  const picked = document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
  return picked ? picked.value : 'unanswered';
}

function refreshResult(): void {
  const box = document.getElementById('result');
  if (!box) return;

  const lines = [
    'M0 RESULT',
    `environment:      ${environment}`,
    `heard by other:   ${answer('heard')}`,
    `quieter at 10%:   ${answer('volume')}`,
  ];
  for (const a of attempts) {
    lines.push(
      `attempt:          ${a.label} — ` +
        (a.shareOpened
          ? `share opened in ${a.openMs}ms`
          : `REFUSED code=${a.errorCode ?? '?'} "${a.errorMessage}"`),
    );
  }
  if (attempts.length === 0) lines.push('attempt:          none yet');
  box.textContent = lines.join('\n');
}

async function boot(): Promise<void> {
  const root = document.getElementById('spike');
  if (!root) return;

  root.innerHTML = `
    <div class="masthead">
      <h1>M0 — Audio Share Spike</h1>
      <div class="sub" id="env">checking client …</div>
    </div>

    <div class="status">
      <div class="warn">
        Run this inside a real meeting with a second participant on the call.
      </div>
    </div>

    <div class="step">
      <div class="step-n">1</div>
      <div class="step-body">
        <strong>Play at your normal system volume.</strong>
        <button class="primary" id="normal" type="button">Play 2s tone to the meeting</button>
        <div class="q">Did the other person hear it?
          <label><input type="radio" name="heard" value="yes"> yes</label>
          <label><input type="radio" name="heard" value="no"> no</label>
        </div>
      </div>
    </div>

    <div class="step">
      <div class="step-n">2</div>
      <div class="step-body">
        <strong>Now set your system volume to about 10% and play again.</strong>
        <button id="quiet" type="button">Play 2s tone to the meeting</button>
        <div class="q">Was it noticeably quieter for them?
          <label><input type="radio" name="volume" value="yes"> yes</label>
          <label><input type="radio" name="volume" value="no"> no — same level</label>
        </div>
      </div>
    </div>

    <div class="row">
      <button id="local" type="button">Play locally only (control)</button>
    </div>

    <div class="field-label">Paste this back:</div>
    <pre id="result" class="log"></pre>
    <div class="field-label">Event log:</div>
    <pre id="log" class="log"></pre>
  `;

  document.getElementById('normal')?.addEventListener('click', () => void runAttempt('normal volume'));
  document.getElementById('quiet')?.addEventListener('click', () => void runAttempt('~10% volume'));
  document.getElementById('local')?.addEventListener('click', () => {
    note('local tone (no share)');
    void playTone();
  });
  for (const input of document.querySelectorAll('input[type="radio"]')) {
    input.addEventListener('change', refreshResult);
  }

  const envLine = document.getElementById('env');
  try {
    const config = await zoomSdk.config({
      version: '0.16',
      capabilities: ['shareComputerAudio', 'onShareComputerAudio', 'onShareScreen', 'getRunningContext', 'getUserContext'],
    });
    const unsupported = config.unsupportedApis ?? [];
    const shareOk = !unsupported.includes('shareComputerAudio');
    environment = `${config.runningContext}, client ${config.clientVersion}, shareComputerAudio ${shareOk ? 'available' : 'UNSUPPORTED'}`;
    if (envLine) envLine.textContent = environment;
    note(`configured: ${environment}`);
    if (unsupported.length) note(`unsupported: ${unsupported.join(', ')}`);

    zoomSdk.onShareComputerAudio((event) => {
      note(`onShareComputerAudio ${event.action} by ${event.participantUUID.slice(0, 8)}…`);
    });
    zoomSdk.onShareScreen((event) => {
      note(`onShareScreen ${event.action} withSound=${event.withSound} by ${event.participantUUID.slice(0, 8)}…`);
    });
  } catch (error) {
    environment = 'Zoom SDK unavailable — this page must be opened inside the Zoom client';
    if (envLine) envLine.textContent = environment;
    note(`config failed: ${toZoomFailure(error).message}`);
  }
  refreshResult();
}

void boot();
