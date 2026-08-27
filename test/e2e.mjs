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
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../dist', import.meta.url).pathname;
const SHOTS = process.env.SHOTS ?? null;
const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const HEADERS = Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value]));

const problems = [];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wav': 'audio/wav' };

const server = createServer(async (req, res) => {
  let path = normalize(decodeURI((req.url || '/').split('?')[0]));
  if (path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(ROOT, path));
    // Exactly the headers Vercel will send in production.
    res.writeHead(200, { ...HEADERS, 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    problems.push(`[404] ${path}`); res.writeHead(404, HEADERS); res.end('not found');
  }
});
await new Promise((r) => server.listen(4173, r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
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
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
log('IDLE          ' + JSON.stringify(await readout()));
await step('01-idle');

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
