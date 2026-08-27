/**
 * Rendering. The DOM is built once and updated in place -- the countdown
 * repaints several times a second and rebuilding would drop focus from the
 * custom-duration field mid-typing.
 */
import { formatAgo, formatDuration, parseDuration } from './format';
import type { TimerSnapshot } from './timer';

export const PRESETS_MS = [60_000, 300_000, 600_000, 900_000, 1_200_000];

export interface ViewModel {
  snapshot: TimerSnapshot;
  /** Will the chime reach the meeting if a timer fires now? */
  sharedAudioAvailable: boolean;
  /** Will other participants see the countdown? */
  sharedCountdownAvailable: boolean;
  /** Set while our audio share is open. */
  shareOpen: boolean;
  /** Something the user could act on before starting, e.g. "turn on Share sound". */
  advisory: string | null;
  /** Whether that advisory is one promptShareScreen can help with. */
  advisoryHasPrompt: boolean;
  /** Outcome text from the run that just fired. */
  lastOutcome: string | null;
  /** Show the audio disclosure instead of the duration chooser. */
  needsAudioDisclosure: boolean;
  contextNote: string;
}

export interface Handlers {
  onStart(durationMs: number): void;
  onRestart(): void;
  onPause(): void;
  onResume(): void;
  onReset(): void;
  onExtend(ms: number): void;
  onPromptShare(): void;
  onAcknowledgeDisclosure(): void;
  onPreviewChime(): void;
}

interface Nodes {
  sub: HTMLElement;
  readout: HTMLElement;
  time: HTMLElement;
  caption: HTMLElement;
  controls: HTMLElement;
  chooser: HTMLElement;
  disclosure: HTMLElement;
  presets: HTMLElement;
  customInput: HTMLInputElement;
  customStart: HTMLButtonElement;
  status: HTMLElement;
}

let nodes: Nodes | null = null;
let handlers: Handlers | null = null;

export function mount(root: HTMLElement, h: Handlers): void {
  handlers = h;
  root.textContent = '';

  const masthead = el('div', 'masthead');
  const title = el('h1');
  title.textContent = 'Meeting Timer';
  const sub = el('div', 'sub');
  masthead.append(title, sub);

  const readout = el('div', 'readout');
  const time = el('div', 'time');
  const caption = el('div', 'caption');
  readout.append(time, caption);

  const controls = el('div', 'row');

  const chooser = el('div');
  chooser.style.display = 'flex';
  chooser.style.flexDirection = 'column';
  chooser.style.gap = '8px';

  const presets = el('div', 'presets');
  for (const ms of PRESETS_MS) {
    const button = el('button') as HTMLButtonElement;
    button.type = 'button';
    button.textContent = formatDuration(ms);
    button.addEventListener('click', () => handlers?.onStart(ms));
    presets.append(button);
  }

  const customLabel = el('div', 'field-label');
  customLabel.textContent = 'Custom — minutes, or m:ss';

  const custom = el('div', 'custom');
  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.inputMode = 'numeric';
  customInput.placeholder = '7:30';
  customInput.setAttribute('aria-label', 'Custom duration');
  const customStart = el('button') as HTMLButtonElement;
  customStart.type = 'button';
  customStart.textContent = 'Start';
  custom.append(customInput, customStart);

  const submitCustom = (): void => {
    const parsed = parseInput(customInput.value);
    if (parsed === null) {
      customInput.setAttribute('aria-invalid', 'true');
      return;
    }
    customInput.removeAttribute('aria-invalid');
    customInput.value = '';
    handlers?.onStart(parsed);
  };
  customStart.addEventListener('click', submitCustom);
  customInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submitCustom();
  });

  // Only you hear this one. Without it the sound cannot be heard without
  // running a timer to zero in a live meeting.
  const preview = el('button', 'link') as HTMLButtonElement;
  preview.type = 'button';
  preview.textContent = 'Preview chime — only you hear this';
  preview.addEventListener('click', () => handlers?.onPreviewChime());

  chooser.append(presets, customLabel, custom, preview);

  const disclosure = buildDisclosure();
  const status = el('div', 'status');

  root.append(masthead, readout, controls, disclosure, chooser, el('div', 'spacer'), status);
  nodes = { sub, readout, time, caption, controls, chooser, disclosure, presets, customInput, customStart, status };
}

export function render(view: ViewModel): void {
  if (!nodes) return;
  const { snapshot } = view;

  nodes.sub.textContent = view.contextNote;

  nodes.time.textContent =
    snapshot.state === 'idle' ? '—' : formatDuration(snapshot.remainingMs);
  nodes.caption.textContent = captionFor(view);
  nodes.readout.className = `readout is-${snapshot.state}`;

  renderControls(view);

  // The chooser is always live in idle and finished, so starting a different
  // duration never needs a dismissal step first -- unless the audio notice is
  // still standing, which has to be answered before anything can share audio.
  const choosing =
    !view.needsAudioDisclosure && (snapshot.state === 'idle' || snapshot.state === 'finished');
  nodes.chooser.style.display = choosing ? 'flex' : 'none';
  nodes.disclosure.style.display = view.needsAudioDisclosure ? 'flex' : 'none';

  renderStatus(view);
}

function renderControls(view: ViewModel): void {
  if (!nodes || !handlers) return;
  const { state, lastDurationMs } = view.snapshot;
  const row = nodes.controls;
  row.textContent = '';

  switch (state) {
    case 'idle':
      row.style.display = 'none';
      return;

    case 'running':
      row.style.display = 'flex';
      row.append(
        button('Pause', () => handlers?.onPause()),
        button('+1 min', () => handlers?.onExtend(60_000)),
        button('Reset', () => handlers?.onReset()),
      );
      return;

    case 'paused':
      row.style.display = 'flex';
      row.append(
        button('Resume', () => handlers?.onResume(), true),
        button('Reset', () => handlers?.onReset()),
      );
      return;

    case 'firing': {
      // Everything is inert while the share is open and the chime is playing.
      row.style.display = 'flex';
      const waiting = button('Chiming…', () => undefined);
      waiting.disabled = true;
      row.append(waiting);
      return;
    }

    case 'finished':
      row.style.display = 'flex';
      row.append(
        button(`Restart ${formatDuration(lastDurationMs)}`, () => handlers?.onRestart(), true),
        button('Clear', () => handlers?.onReset()),
      );
      return;
  }
}

function renderStatus(view: ViewModel): void {
  if (!nodes || !handlers) return;
  const status = nodes.status;
  status.textContent = '';

  if (view.shareOpen) {
    status.append(line('● Sharing computer audio', 'share-open'));
  }

  if (view.snapshot.state === 'finished' && view.lastOutcome) {
    status.append(line(view.lastOutcome));
  }

  if (view.snapshot.state === 'finished' && view.snapshot.finishedAt !== null) {
    status.append(line(`Finished ${formatAgo(Date.now() - view.snapshot.finishedAt)}.`));
  }

  if (view.advisory) {
    status.append(line(view.advisory, 'warn'));
    if (view.advisoryHasPrompt) {
      const prompt = el('button', 'link') as HTMLButtonElement;
      prompt.type = 'button';
      prompt.textContent = 'Start sharing with sound';
      prompt.addEventListener('click', () => handlers?.onPromptShare());
      status.append(prompt);
    }
  } else if (view.snapshot.state !== 'firing' && view.snapshot.state !== 'finished') {
    status.append(line(reachSummary(view), view.sharedAudioAvailable ? 'live' : undefined));
  }
}

/**
 * The one-time notice. Built with the rest of the DOM and shown by display,
 * because everything here is built once and updated in place.
 */
function buildDisclosure(): HTMLElement {
  const panel = el('div', 'disclosure');

  const heading = el('strong');
  heading.textContent = 'Before your first timer';

  const body = el('p');
  body.textContent =
    "When a timer ends, this app turns on Zoom's share computer audio so everyone hears the " +
    'chime. For those few seconds, anything else playing on your computer is audible to the ' +
    'meeting too. It switches off the moment the chime finishes.';

  const accept = el('button', 'primary') as HTMLButtonElement;
  accept.type = 'button';
  accept.textContent = 'Got it';
  accept.addEventListener('click', () => handlers?.onAcknowledgeDisclosure());

  const more = el('a', 'fine-link') as HTMLAnchorElement;
  more.href = '/privacy/';
  more.target = '_blank';
  more.rel = 'noreferrer';
  more.textContent = 'What this app stores';

  panel.append(heading, body, accept, more);
  return panel;
}

function reachSummary(view: ViewModel): string {
  if (view.sharedAudioAvailable && view.sharedCountdownAvailable) {
    return '✓ Everyone will see the countdown and hear the chime.';
  }
  if (view.sharedCountdownAvailable) {
    return 'Everyone will see the countdown. Only you will hear the chime.';
  }
  if (view.sharedAudioAvailable) {
    return 'Everyone will hear the chime.';
  }
  return 'Local timer — start a meeting to share the countdown and chime.';
}

function captionFor(view: ViewModel): string {
  switch (view.snapshot.state) {
    case 'idle': return 'Pick a duration';
    case 'running': return 'Running';
    case 'paused': return 'Paused';
    case 'firing': return "Time's up";
    case 'finished': return "Time's up";
  }
}

function parseInput(value: string): number | null {
  const ms = parseDuration(value);
  return ms !== null && ms > 0 ? ms : null;
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const node = el('button', primary ? 'primary' : undefined) as HTMLButtonElement;
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

function line(text: string, className?: string): HTMLElement {
  const node = el('div', className);
  node.textContent = text;
  return node;
}

function el(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
