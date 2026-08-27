/**
 * Zoom's deauthorization webhook.
 *
 * Every published Marketplace app must expose one: Zoom calls it when a user
 * removes the app, and calls it once at setup time with a challenge to prove
 * the URL is yours.
 *
 * This app stores nothing. There is no account record to delete, no token at
 * rest, no copy of a meeting anywhere -- the only state it has ever written
 * is a duration in the browser's own localStorage, which goes when the user's
 * client does. So the handler verifies the call is genuinely Zoom's and
 * acknowledges it. That emptiness is the point; it is worth saying plainly
 * here, because "the handler does nothing" reads like an oversight otherwise.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const config = { runtime: 'nodejs' };

/** Zoom rejects a slow endpoint, and a stale timestamp is a replay. */
const MAX_SKEW_MS = 5 * 60 * 1000;

interface ZoomEvent {
  event?: string;
  payload?: { plainToken?: string };
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return text('Method not allowed.', 405);

  const secret = process.env.ZM_WEBHOOK_SECRET_TOKEN;
  if (!secret) return text('Server is missing ZM_WEBHOOK_SECRET_TOKEN.', 500);

  // The signature covers the bytes as sent, so the raw body has to be read
  // before anything parses it.
  const raw = await request.text();
  const timestamp = request.headers.get('x-zm-request-timestamp');
  const signature = request.headers.get('x-zm-signature');

  if (!timestamp || !signature) return text('Missing Zoom signature headers.', 401);
  if (!isFresh(timestamp)) return text('Stale request timestamp.', 401);
  if (!signatureMatches(signature, `v0:${timestamp}:${raw}`, secret)) {
    return text('Signature mismatch.', 401);
  }

  let body: ZoomEvent;
  try {
    body = JSON.parse(raw) as ZoomEvent;
  } catch {
    return text('Body was not JSON.', 400);
  }

  // Setup handshake: Zoom sends a token and expects it back both in the clear
  // and signed, which proves we hold the secret.
  if (body.event === 'endpoint.url_validation') {
    const plainToken = body.payload?.plainToken;
    if (!plainToken) return text('Validation request had no plainToken.', 400);
    return json({
      plainToken,
      encryptedToken: createHmac('sha256', secret).update(plainToken).digest('hex'),
    });
  }

  if (body.event === 'app_deauthorized') {
    // Nothing to erase. Logged so an uninstall is visible in the function log
    // rather than silent, without recording who did it.
    console.info('app_deauthorized received; no stored data to remove');
    return text('OK', 200);
  }

  // An event we did not subscribe to. Acknowledge rather than error, so Zoom
  // does not retry something we are never going to act on.
  return text('Ignored.', 200);
}

function isFresh(timestamp: string): boolean {
  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return false;
  return Math.abs(Date.now() - sent) <= MAX_SKEW_MS;
}

function signatureMatches(header: string, message: string, secret: string): boolean {
  const expected = `v0=${createHmac('sha256', secret).update(message).digest('hex')}`;
  const sent = Buffer.from(header);
  const want = Buffer.from(expected);
  return sent.length === want.length && timingSafeEqual(sent, want);
}

function text(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
