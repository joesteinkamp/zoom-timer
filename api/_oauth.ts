/**
 * Shared OAuth helpers for the two install-flow functions.
 *
 * Vercel functions are stateless, so the `state` and PKCE verifier that must
 * survive between /api/install and /api/auth travel in a signed, HttpOnly
 * cookie rather than a session store.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ZOOM_HOST = process.env.ZM_HOST ?? 'https://zoom.us';
export const ZOOM_API = 'https://api.zoom.us/v2';
export const COOKIE_NAME = 'zm_oauth';
const COOKIE_TTL_SECONDS = 600;

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
  sessionSecret: string;
}

export function readConfig(): OAuthConfig | null {
  const clientId = process.env.ZM_CLIENT_ID;
  const clientSecret = process.env.ZM_CLIENT_SECRET;
  const redirectUrl = process.env.ZM_REDIRECT_URL;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!clientId || !clientSecret || !redirectUrl || !sessionSecret) return null;
  return { clientId, clientSecret, redirectUrl, sessionSecret };
}

export function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function newVerifier(): string {
  // 32 bytes base64url is 43 chars, inside RFC 7636's 43..128 range.
  return base64url(randomBytes(32));
}

export function challengeFor(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

export interface OAuthState {
  state: string;
  verifier: string;
  exp: number;
}

export function sealState(payload: OAuthState, secret: string): string {
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export function openState(cookie: string | undefined, secret: string): OAuthState | null {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf('.');
  if (dot < 1) return null;

  const body = cookie.slice(0, dot);
  const mac = cookie.slice(dot + 1);
  if (!safeEquals(mac, sign(body, secret))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthState;
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
    if (typeof parsed.state !== 'string' || typeof parsed.verifier !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setCookie(value: string): string {
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_TTL_SECONDS}`;
}

export function clearCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function newState(): string {
  return base64url(randomBytes(24));
}

export function problem(message: string, status = 400): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
