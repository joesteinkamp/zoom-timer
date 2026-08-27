// Exercises the deauthorization endpoint the way Zoom will: the setup
// challenge, a real event, and every way a forged call has to be refused.
// Zoom validates this URL before it will let you save it, so a mistake here
// blocks the submission rather than showing up later.
import { createHmac } from 'node:crypto';

const SECRET = 'test-secret-token';
process.env.ZM_WEBHOOK_SECRET_TOKEN = SECRET;

const handler = (await import('../api/deauthorize.ts')).default;

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.log(`FAIL ${name}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`); }
  else console.log(`ok   ${name}`);
}

function sign(timestamp: string, body: string): string {
  return `v0=${createHmac('sha256', SECRET).update(`v0:${timestamp}:${body}`).digest('hex')}`;
}

function post(body: unknown, options: { timestamp?: string; signature?: string } = {}): Request {
  const raw = JSON.stringify(body);
  const timestamp = options.timestamp ?? String(Date.now());
  return new Request('https://example.test/api/deauthorize', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zm-request-timestamp': timestamp,
      'x-zm-signature': options.signature ?? sign(timestamp, raw),
    },
    body: raw,
  });
}

// ---- the setup challenge ----
const challenge = { event: 'endpoint.url_validation', payload: { plainToken: 'abc123' } };
const validation = await handler(post(challenge));
const answered = (await validation.json()) as { plainToken?: string; encryptedToken?: string };
check('validation answers 200', validation.status, 200);
check('validation echoes the token', answered.plainToken, 'abc123');
check(
  'validation signs the token with the secret',
  answered.encryptedToken,
  createHmac('sha256', SECRET).update('abc123').digest('hex'),
);

// ---- a real deauthorization ----
const deauth = { event: 'app_deauthorized', payload: { user_id: 'u1', account_id: 'a1' } };
check('deauthorization is acknowledged', (await handler(post(deauth))).status, 200);

// An event we never subscribed to is acknowledged rather than errored, so
// Zoom does not retry something we are never going to act on.
check('unknown event is acknowledged', (await handler(post({ event: 'meeting.started' }))).status, 200);

// ---- refusals ----
check(
  'forged signature is refused',
  (await handler(post(deauth, { signature: 'v0=' + '0'.repeat(64) }))).status,
  401,
);

// A signature that is valid, but for a timestamp far enough in the past to be
// a replay of a call Zoom made once.
const old = String(Date.now() - 10 * 60 * 1000);
check('replayed request is refused', (await handler(post(deauth, { timestamp: old }))).status, 401);

const unsigned = new Request('https://example.test/api/deauthorize', {
  method: 'POST',
  body: JSON.stringify(deauth),
});
check('unsigned request is refused', (await handler(unsigned)).status, 401);

check(
  'GET is refused',
  (await handler(new Request('https://example.test/api/deauthorize'))).status,
  405,
);

// Signed correctly, but not JSON -- the signature check must come first, and
// then the parse has to fail cleanly rather than throwing.
const timestamp = String(Date.now());
const garbled = new Request('https://example.test/api/deauthorize', {
  method: 'POST',
  headers: {
    'x-zm-request-timestamp': timestamp,
    'x-zm-signature': sign(timestamp, 'not json'),
  },
  body: 'not json',
});
check('signed non-JSON is refused cleanly', (await handler(garbled)).status, 400);

// ---- misconfiguration ----
delete process.env.ZM_WEBHOOK_SECRET_TOKEN;
check('missing secret is a server error, not a silent pass', (await handler(post(deauth))).status, 500);
process.env.ZM_WEBHOOK_SECRET_TOKEN = SECRET;

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
