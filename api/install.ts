/**
 * Step 1 of the Zoom App install: mint OAuth state and a PKCE verifier,
 * stash them in a signed cookie, and hand the user to Zoom's consent screen.
 */
import {
  challengeFor,
  newState,
  newVerifier,
  problem,
  readConfig,
  sealState,
  setCookie,
  ZOOM_HOST,
} from './_oauth';

export const config = { runtime: 'nodejs' };

export default function handler(): Response {
  const settings = readConfig();
  if (!settings) return problem('Server is missing Zoom OAuth environment variables.', 500, false);

  const state = newState();
  const verifier = newVerifier();

  const url = new URL('/oauth/authorize', ZOOM_HOST);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', settings.clientId);
  url.searchParams.set('redirect_uri', settings.redirectUrl);
  url.searchParams.set('code_challenge', challengeFor(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  // Only sent when ZM_SCOPES is set. Zoom otherwise grants what the app
  // registration was configured with; asking for a scope that was never
  // granted fails the authorize outright rather than degrading.
  if (settings.scopes) url.searchParams.set('scope', settings.scopes);

  const sealed = sealState({ state, verifier, exp: Date.now() + 600_000 }, settings.sessionSecret);

  return new Response(null, {
    status: 302,
    headers: { Location: url.href, 'Set-Cookie': setCookie(sealed) },
  });
}
