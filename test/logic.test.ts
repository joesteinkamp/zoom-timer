// Exercises the pure logic with Node's type stripping. No DOM, so
// localStorage is stubbed the way a blocked-storage browser behaves.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

import { Timer, PREARM_LEAD_MS } from '../src/timer.ts';
import { formatDuration, parseDuration, formatAgo } from '../src/format.ts';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.log(`FAIL ${name}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`); }
  else console.log(`ok   ${name}`);
}
function assert(name: string, cond: boolean) { check(name, cond, true); }

// ---- format ----
check('format 0', formatDuration(0), '0:00');
check('format 61s', formatDuration(61_000), '1:01');
check('format 5m', formatDuration(300_000), '5:00');
check('format 1h', formatDuration(3_661_000), '1:01:01');
check('format rounds up', formatDuration(1500), '0:02');
check('parse bare minutes', parseDuration('5'), 300_000);
check('parse mm:ss', parseDuration('7:30'), 450_000);
check('parse 90s', parseDuration('90s'), 90_000);
check('parse 2m30s', parseDuration('2m30s'), 150_000);
check('parse junk', parseDuration('abc'), null);
check('parse empty', parseDuration('  '), null);
check('ago', formatAgo(125_000), '2m ago');

// ---- timer ----
const t = new Timer();
const prearms: Array<{ runId: number; leadMs: number }> = [];
t.onPrearm((e) => prearms.push(e));

check('starts idle', t.snapshot().state, 'idle');

const run1 = t.start(60_000);
check('running after start', t.snapshot().state, 'running');
assert('remaining near 60s', Math.abs(t.snapshot().remainingMs - 60_000) < 50);

t.pause();
check('paused', t.snapshot().state, 'paused');
const held = t.snapshot().remainingMs;
t.resume();
check('resumed', t.snapshot().state, 'running');
assert('resume preserves remaining', Math.abs(t.snapshot().remainingMs - held) < 50);

t.extend(30_000);
assert('extend adds time', t.snapshot().remainingMs > 89_000);

// A restart must bump the runId -- that is what makes the old run's
// in-flight callbacks no-ops.
const run2 = t.start(1000);
assert('restart bumps runId', run2 > run1);
check('lastDuration tracks', t.snapshot().lastDurationMs, 1000);

// Drive into the prearm window.
await new Promise((r) => setTimeout(r, 1400));
check('fires once', prearms.length, 1);
check('prearm carries current runId', prearms[0].runId, run2);
check('state is firing', t.snapshot().state, 'firing');
assert('lead within window', prearms[0].leadMs >= 0 && prearms[0].leadMs <= PREARM_LEAD_MS);

// A stale runId must not be able to finish the current run.
t.markFinished(run1);
check('stale markFinished ignored', t.snapshot().state, 'firing');
t.markFinished(run2);
check('current markFinished lands', t.snapshot().state, 'finished');
assert('finishedAt set', t.snapshot().finishedAt !== null);

// Finished offers a restart at the same duration.
const run3 = t.restart();
assert('restart from finished bumps runId', run3 > run2);
check('restart uses last duration', t.snapshot().durationMs, 1000);
check('restart is running', t.snapshot().state, 'running');

t.reset();
check('reset returns to idle', t.snapshot().state, 'idle');
check('reset keeps lastDuration', t.snapshot().lastDurationMs, 1000);
t.dispose();

// ---- audio disclosure ----
// Imported here rather than at the top: it reads storage as it loads, and
// ESM evaluates every static import before the stub above exists.
const consent = await import('../src/consent.ts');

check('disclosure unanswered on a fresh install', consent.isAcknowledged(), false);
consent.acknowledge();
assert('disclosure sticks once answered', consent.isAcknowledged());
check('answer is stored by version', store.get('zoom-timer:audio-disclosure'), consent.DISCLOSURE_VERSION);
consent.forget();
check('forget clears the answer', consent.isAcknowledged(), false);
check('forget clears storage too', store.has('zoom-timer:audio-disclosure'), false);

// A private window throws on write. The answer must still hold for the
// session -- and be asked again next time, which is the safe way to fail.
const workingSetItem = (globalThis as any).localStorage.setItem;
(globalThis as any).localStorage.setItem = () => { throw new Error('blocked'); };
consent.acknowledge();
assert('answer holds for the session when storage is blocked', consent.isAcknowledged());
check('nothing was written', store.has('zoom-timer:audio-disclosure'), false);
(globalThis as any).localStorage.setItem = workingSetItem;
consent.forget();

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
