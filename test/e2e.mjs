/**
 * End-to-end check: serves the production bundle with the exact headers from
 * vercel.json and drives the app in Chromium.
 *
 * Serving the real headers is the point -- this is what caught an inline
 * style attribute that our own `style-src 'self'` refuses, which would have
 * rendered the spike page unstyled inside Zoom and looked like anything but
 * a CSP problem.
 *
 * It cannot exercise the Zoom SDK; nothing outside the Zoom client can.
 *
 *   node test/e2e.mjs            # pass/fail
 *   SHOTS=./shots node test/e2e.mjs   # also write screenshots
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { globSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../dist', import.meta.url).pathname;
const SPIKE_ROOT = new URL('../dist-spike', import.meta.url).pathname;
const SHOTS = process.env.SHOTS ?? null;
const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));

const problems = [];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wav': 'audio/wav', '.svg': 'image/svg+xml' };

/**
 * Every header Zoom's client checks for on a document response. A home URL
 * missing one is blocked from rendering inside the client with no useful
 * error, so a regression here has to fail the build rather than the meeting.
 */
const REQUIRED_HEADERS = [
  'strict-transport-security',
  'x-content-type-options',
  'referrer-policy',
  'x-frame-options',
  'x-permitted-cross-domain-policies',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'permissions-policy',
  'content-security-policy',
];

/** Apply vercel.json's rules the way Vercel would, in order, most-general first. */
function headersFor(path) {
  const applied = {};
  for (const rule of vercel.headers) {
    const matches = rule.source === '/(.*)' || (rule.source === '/' && path === '/index.html');
    if (matches) for (const h of rule.headers) applied[h.key] = h.value;
  }
  return applied;
}

/**
 * The spike is deliberately absent from a production build, so it is built
 * separately here -- which also proves the gate works in both directions.
 */
await access(join(ROOT, 'spike', 'index.html'))
  .then(() => problems.push('[spike] production build contains /spike/ — the gate is not working'))
  .catch(() => undefined);
execFileSync('npx', ['vite', 'build'], {
  stdio: 'ignore',
  env: { ...process.env, INCLUDE_SPIKE: '1', OUT_DIR: 'dist-spike' },
});

const server = createServer(async (req, res) => {
  let path = normalize(decodeURI((req.url || '/').split('?')[0]));
  if (path.endsWith('/')) path += 'index.html';
  // /spike/ exists only in the second bundle. Its hashed assets live under
  // /assets/ like everything else, so those fall back to it -- the two
  // bundles hash to different names, and only one root can answer.
  const roots = path.startsWith('/spike/') ? [SPIKE_ROOT] : [ROOT, SPIKE_ROOT];
  for (const root of roots) {
    try {
      const body = await readFile(join(root, path));
      // Exactly the headers Vercel will send in production, for this path.
      res.writeHead(200, { ...headersFor(path), 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
      return;
    } catch {
      /* Try the next root. */
    }
  }
  problems.push(`[404] ${path}`); res.writeHead(404, headersFor(path)); res.end('not found');
});
await new Promise((r) => server.listen(4173, r));

// Playwright's own resolution first, so this runs on a CI runner; the glob is
// for sandboxes that ship a browser at a path Playwright does not expect.
const local = globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome');
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? local[0],
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 640 } });


page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(t)) problems.push(`[${m.type()}] ${t}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => problems.push(`[404?] ${r.url()}`));
page.on('response', (r) => { if (r.status() >= 400) problems.push(`[${r.status()}] ${r.url()}`); });

const step = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const readout = () => page.evaluate(() => ({
  time: document.querySelector('.readout .time')?.textContent,
  caption: document.querySelector('.readout .caption')?.textContent,
  state: document.querySelector('.readout')?.className,
  buttons: [...document.querySelectorAll('.row button')].map((b) => b.textContent),
  status: [...document.querySelectorAll('.status > *')].map((n) => n.textContent),
  sub: document.querySelector('.masthead .sub')?.textContent,
}));

const out = [];
const log = (s) => { out.push(s); console.log(s); };

// ---------- main app ----------
const first = await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
const sent = first.headers();
const missing = REQUIRED_HEADERS.filter((h) => !sent[h]);
if (missing.length) problems.push(`[headers] home URL is missing: ${missing.join(', ')}`);
log('HEADERS       ' + JSON.stringify({ required: REQUIRED_HEADERS.length, missing, cache: sent['cache-control'] }));

log('IDLE          ' + JSON.stringify(await readout()));
await step('01-idle');

// No audio share is possible outside the Zoom client, so the notice about
// what one does must not be shown here -- it would warn about something that
// cannot happen.
const disclosureShown = await page.evaluate(
  () => getComputedStyle(document.querySelector('.disclosure')).display !== 'none',
);
if (disclosureShown) problems.push('[disclosure] shown on a client that cannot share audio');

// The panel is built with everything else and hidden by display, so its copy
// can be checked here even where it would never be shown. Toggled through the
// CSSOM rather than a style attribute, which this app's CSP refuses.
const disclosure = await page.evaluate(() => {
  const node = document.querySelector('.disclosure');
  node.style.display = 'flex';
  const text = node.textContent;
  return {
    heading: node.querySelector('strong')?.textContent,
    button: node.querySelector('button')?.textContent,
    saysWhatIsShared: /anything else playing on your computer/.test(text),
    saysWhenItStops: /switches off the moment the chime finishes/.test(text),
  };
});
if (!disclosure.saysWhatIsShared || !disclosure.saysWhenItStops) {
  problems.push('[disclosure] copy no longer states what is shared and when it stops');
}
log('DISCLOSURE    ' + JSON.stringify(disclosure));
await step('01c-disclosure');
await page.evaluate(() => { document.querySelector('.disclosure').style.display = 'none'; });

// The preview plays locally and must never open a share.
await page.click('text=/^Preview chime/');
await page.waitForTimeout(300);
log('PREVIEW       ' + JSON.stringify({ disclosureShown, status: (await readout()).status }));
await step('01b-preview');

// Verify the chime is a real, decodable asset in a real browser.
const chime = await page.evaluate(async () => {
  const url = [...document.querySelectorAll('link,script')].length && (await fetch('/assets/' +
    (await (await fetch('/index.html')).text()).match(/assets\/main-[\w-]+\.js/)[0].split('/')[1]));
  const js = await url.text();
  const name = js.match(/assets\/chime-[\w-]+\.wav/)[0];
  const buf = await (await fetch('/' + name)).arrayBuffer();
  const decoded = await new AudioContext().decodeAudioData(buf);
  let peak = 0;
  const data = decoded.getChannelData(0);
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  return { file: name, seconds: +decoded.duration.toFixed(3), rate: decoded.sampleRate, channels: decoded.numberOfChannels, peak: +peak.toFixed(3) };
});
log('CHIME         ' + JSON.stringify(chime));

// Run a real 3-second timer end to end.
await page.fill('.custom input', '0:03');
await page.click('.custom button');
await page.waitForTimeout(600);
log('RUNNING       ' + JSON.stringify(await readout()));
await step('02-running');

await page.click('text=Pause');
log('PAUSED        ' + JSON.stringify(await readout()));
await step('03-paused');
await page.click('text=Resume');

await page.waitForFunction(() => document.querySelector('.readout')?.className.includes('is-firing'), null, { timeout: 8000 });
log('FIRING        ' + JSON.stringify(await readout()));
await step('04-firing');

await page.waitForFunction(() => document.querySelector('.readout')?.className.includes('is-finished'), null, { timeout: 15000 });
log('FINISHED      ' + JSON.stringify(await readout()));
await step('05-finished');

// The whole point of the lifecycle work: restart straight from finished.
await page.click('text=/^Restart/');
await page.waitForTimeout(400);
log('RESTARTED     ' + JSON.stringify(await readout()));
await step('06-restarted');

// And starting a *different* duration from finished, without a dismissal step.
await page.waitForFunction(() => document.querySelector('.readout')?.className.includes('is-finished'), null, { timeout: 15000 });
await page.click('.presets button >> nth=1');
await page.waitForTimeout(400);
log('NEW DURATION  ' + JSON.stringify(await readout()));
await step('07-new-duration');
await page.click('text=Reset');

// The four Marketplace URLs have to exist and carry the same headers.
for (const path of ['/privacy/', '/terms/', '/support/', '/docs/']) {
  const res = await page.goto(`http://localhost:4173${path}`, { waitUntil: 'networkidle' });
  const gaps = REQUIRED_HEADERS.filter((h) => !res.headers()[h]);
  const title = await page.title();
  if (res.status() !== 200) problems.push(`[${res.status()}] ${path}`);
  if (gaps.length) problems.push(`[headers] ${path} is missing: ${gaps.join(', ')}`);
  log(`PAGE ${path.padEnd(9)} ` + JSON.stringify({ status: res.status(), title }));
}

// ---------- spike page ----------
await page.goto('http://localhost:4173/spike/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
log('SPIKE         ' + JSON.stringify(await page.evaluate(() => ({
  sub: document.querySelector('.masthead .sub')?.textContent,
  buttons: [...document.querySelectorAll('button')].map((b) => b.textContent),
  log: document.getElementById('log')?.textContent?.split('\n')[0],
}))));
await step('08-spike');

await browser.close();
server.close();

if (problems.length) {
  log('\nPROBLEMS:\n' + problems.join('\n'));
  process.exit(1);
}
log('\nNo console errors, CSP violations, or failed requests.');
