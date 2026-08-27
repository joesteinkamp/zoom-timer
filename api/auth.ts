/**
 * Step 2 of the install: exchange the authorization code for an access
 * token, then ask Zoom for the deeplink that reopens the app inside the
 * client. This is the only place the client secret is ever used.
 */
import {
  clearCookie,
  COOKIE_NAME,
  openState,
  problem,
  readConfig,
  readCookie,
  ZOOM_API,
  ZOOM_HOST,
} from './_oauth';

export const config = { runtime: 'nodejs' };

export default async function handler(request: Request): Promise<Response> {
  const settings = readConfig();
  if (!settings) return problem('Server is missing Zoom OAuth environment variables.', 500);

  const query = new URL(request.url).searchParams;
  const code = query.get('code');
  const state = query.get('state');
  if (!code || !state) return problem('Missing code or state.');

  const sealed = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  const stored = openState(sealed, settings.sessionSecret);
  if (!stored) return problem('Install session expired. Start again from /api/install.');
  if (stored.state !== state) return problem('State mismatch.');

  const basic = Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString('base64');

  const tokenResponse = await fetch(new URL('/oauth/token', ZOOM_HOST), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: stored.verifier,
      redirect_uri: settings.redirectUrl,
    }),
  });

  if (!tokenResponse.ok) {
    return problem(`Token exchange failed (${tokenResponse.status}).`, 502);
  }
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) return problem('Token exchange returned no access token.', 502);

  const deeplinkResponse = await fetch(`${ZOOM_API}/zoomapp/deeplink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: JSON.stringify({ url: '/', role_name: 'Owner', verified: 1, role_id: 0 }),
    }),
  });

  if (!deeplinkResponse.ok) {
    return problem(`Deeplink request failed (${deeplinkResponse.status}).`, 502);
  }
  const deeplink = (await deeplinkResponse.json()) as { deeplink?: string };
  if (!deeplink.deeplink) return problem('Deeplink request returned no link.', 502);

  return new Response(null, {
    status: 302,
    headers: { Location: deeplink.deeplink, 'Set-Cookie': clearCookie() },
  });
}
