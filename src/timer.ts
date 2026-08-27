/**
 * The timer state machine.
 *
 * Two rules drive the whole design:
 *
 *  1. Never accumulate. Everything derives from an absolute `endsAt`
 *     timestamp and `Date.now()`, so a throttled or suspended webview
 *     cannot make the timer drift.
 *  2. Every run carries a monotonic `runId`. Async work started by a run
 *     (the scheduled chime, the share watchdog) captures its id and checks
 *     it before acting, so a fast restart can never let run N-1 tear down
 *     run N.
 */

export type TimerState = 'idle' | 'running' | 'paused' | 'firing' | 'finished';

export interface TimerSnapshot {
  state: TimerState;
  runId: number;
  /** Duration of the current or most recent run. */
  durationMs: number;
  /** Live remaining time; 0 once firing. */
  remainingMs: number;
  /** Duration to offer on the Restart button. Survives reset. */
  lastDurationMs: number;
  /** When the run finished, for "2m ago". */
  finishedAt: number | null;
}

export interface PrearmEvent {
  runId: number;
  /** Milliseconds from now until the chime should sound. Never negative. */
  leadMs: number;
}

/**
 * How early we enter `firing`. The audio share needs a beat to open before
 * the chime plays, or the first part of it is swallowed.
 */
export const PREARM_LEAD_MS = 1200;

const TICK_MS = 200;
const LAST_DURATION_KEY = 'zoom-timer:last-duration';

type ChangeListener = (snapshot: TimerSnapshot) => void;
type PrearmListener = (event: PrearmEvent) => void;

export class Timer {
  private state: TimerState = 'idle';
  private runId = 0;
  private durationMs = 0;
  private endsAt = 0;
  private pausedRemainingMs = 0;
  private lastDurationMs: number;
  private finishedAt: number | null = null;
  private prearmed = false;

  private ticker: ReturnType<typeof setInterval> | null = null;
  private changeListeners = new Set<ChangeListener>();
  private prearmListeners = new Set<PrearmListener>();

  constructor() {
    this.lastDurationMs = readStoredDuration() ?? 5 * 60 * 1000;
  }

  onChange(fn: ChangeListener): void {
    this.changeListeners.add(fn);
  }

  onPrearm(fn: PrearmListener): void {
    this.prearmListeners.add(fn);
  }

  snapshot(): TimerSnapshot {
    return {
      state: this.state,
      runId: this.runId,
      durationMs: this.durationMs,
      remainingMs: this.remainingMs(),
      lastDurationMs: this.lastDurationMs,
      finishedAt: this.finishedAt,
    };
  }

  remainingMs(): number {
    switch (this.state) {
      case 'running':
        return Math.max(0, this.endsAt - Date.now());
      case 'paused':
        return this.pausedRemainingMs;
      case 'idle':
        return 0;
      default:
        return 0;
    }
  }

  /** True while a run owns the audio path -- controls must be inert. */
  isBusy(): boolean {
    return this.state === 'firing';
  }

  start(durationMs: number): number {
    if (durationMs <= 0) return this.runId;
    this.runId += 1;
    this.state = 'running';
    this.durationMs = durationMs;
    this.lastDurationMs = durationMs;
    this.endsAt = Date.now() + durationMs;
    this.pausedRemainingMs = 0;
    this.finishedAt = null;
    this.prearmed = false;
    writeStoredDuration(durationMs);
    this.startTicking();
    this.emitChange();
    return this.runId;
  }

  restart(): number {
    return this.start(this.lastDurationMs);
  }

  pause(): void {
    if (this.state !== 'running') return;
    this.pausedRemainingMs = this.remainingMs();
    this.state = 'paused';
    this.stopTicking();
    this.emitChange();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.endsAt = Date.now() + this.pausedRemainingMs;
    this.state = 'running';
    this.startTicking();
    this.emitChange();
  }

  /** Add time to a live run. Mirrors Zoom's extendDynamicIndicator. */
  extend(ms: number): boolean {
    if (this.state === 'running') {
      this.endsAt += ms;
      this.durationMs += ms;
      // Re-arm: an extension can pull us back out of the prearm window.
      if (this.remainingMs() > PREARM_LEAD_MS) this.prearmed = false;
      this.emitChange();
      return true;
    }
    if (this.state === 'paused') {
      this.pausedRemainingMs += ms;
      this.durationMs += ms;
      this.emitChange();
      return true;
    }
    return false;
  }

  /**
   * Abandon the current run. Bumping the runId is what makes any in-flight
   * callback from that run a no-op.
   */
  reset(): void {
    this.runId += 1;
    this.state = 'idle';
    this.durationMs = 0;
    this.endsAt = 0;
    this.pausedRemainingMs = 0;
    this.finishedAt = null;
    this.prearmed = false;
    this.stopTicking();
    this.emitChange();
  }

  /** Called by the controller once the chime has played and the share is closed. */
  markFinished(runId: number): void {
    if (runId !== this.runId || this.state !== 'firing') return;
    this.state = 'finished';
    this.finishedAt = Date.now();
    this.stopTicking();
    this.emitChange();
  }

  /**
   * Recompute now rather than waiting for the next tick. Call this whenever
   * the app becomes visible again -- a hidden webview gets its timers
   * throttled hard, and the run may already be due.
   */
  syncNow(): void {
    this.tick();
  }

  dispose(): void {
    this.stopTicking();
    this.changeListeners.clear();
    this.prearmListeners.clear();
  }

  private tick(): void {
    if (this.state !== 'running') return;

    const remaining = this.remainingMs();
    if (remaining > PREARM_LEAD_MS) {
      this.emitChange();
      return;
    }

    if (this.prearmed) {
      this.emitChange();
      return;
    }

    // Enter firing exactly once per run. `leadMs` is clamped at zero because
    // a throttled webview may only wake up after endsAt has already passed.
    this.prearmed = true;
    this.state = 'firing';
    const leadMs = Math.max(0, this.endsAt - Date.now());
    this.emitChange();
    for (const fn of this.prearmListeners) fn({ runId: this.runId, leadMs });
  }

  private startTicking(): void {
    this.stopTicking();
    this.ticker = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTicking(): void {
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private emitChange(): void {
    const snapshot = this.snapshot();
    for (const fn of this.changeListeners) fn(snapshot);
  }
}

function readStoredDuration(): number | null {
  try {
    const raw = localStorage.getItem(LAST_DURATION_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null; // Private windows and blocked site data both throw here.
  }
}

function writeStoredDuration(ms: number): void {
  try {
    localStorage.setItem(LAST_DURATION_KEY, String(ms));
  } catch {
    /* Nothing to do -- the app works fine without a remembered duration. */
  }
}
