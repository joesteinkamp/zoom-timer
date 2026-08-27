# Security and data questionnaire — prepared answers

Answers to what Zoom's submission asks, each traceable to a file in this
repository. Verify against the form's current wording before submitting;
these are the substance, not the exact fields.

## Data handling

**What personal data does the app collect?**
None. The app has no database, no user records, and no server-side storage of
any kind. Its only backend is two stateless functions that run during install
(`api/install.ts`, `api/auth.ts`) and one that answers Zoom's deauthorization
webhook (`api/deauthorize.ts`).

**What data does the app read from Zoom, and where does it go?**
Meeting topic, the user's role, screen name, and participant UUID, plus client
version and running context — all via the Zoom Apps SDK in
`src/zoom.ts`. Every value stays in browser memory for the session and is used
for display or feature detection. None is transmitted anywhere, and none is
written to disk.

**Where is data stored at rest?**
Two values in the browser's own `localStorage`, on the user's device: the last
countdown duration (`src/timer.ts`) and the acknowledgement of the audio
notice (`src/consent.ts`). Nothing else, anywhere.

**Are OAuth tokens stored?**
No. The access token from the code exchange is used once, in the same request,
to fetch the deeplink that opens the app in the client, and is then discarded
(`api/auth.ts`). It is never persisted or logged.

**What cookies does the app set?**
One, during install only: a signed, HttpOnly, Secure, SameSite=Lax cookie
holding the OAuth `state` and PKCE verifier for ten minutes, cleared as soon as
the install completes (`api/_oauth.ts`). No tracking or analytics cookies.

**Does the app access meeting content?**
No. It never requests recordings, transcripts, chat, participant lists, video,
or the microphone. The audio share is outbound only — the app plays a sound;
it does not receive one.

**Sub-processors**
Vercel (hosting the static pages and the three functions) and Zoom itself.
No analytics, error-reporting, or advertising services.

**Data retention and deletion**
Nothing is retained, so there is nothing to delete on request. Uninstalling the
app removes the two locally stored values with the client's app data. The
deauthorization webhook is implemented and acknowledged; it has nothing to
erase.

## Application security

**Transport**
HTTPS only. `Strict-Transport-Security: max-age=31536000; includeSubDomains`
is sent on every response (`vercel.json`).

**Content Security Policy**
`default-src 'self'` with no `unsafe-inline` for scripts or styles, plus
`base-uri`, `form-action`, and `frame-ancestors` restricted to `'self'`
(`vercel.json`). The end-to-end test serves the production bundle with these
exact headers and fails on any violation (`test/e2e.mjs`), which is how the
policy is kept honest rather than aspirational.

**Other response headers**
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`X-Permitted-Cross-Domain-Policies`, `Cross-Origin-Opener-Policy`,
`Cross-Origin-Resource-Policy`, and a `Permissions-Policy` that denies camera,
microphone, geolocation, payment, USB, and display capture. The e2e test
asserts every one of them is present on a document response.

**OAuth**
Authorization code flow with PKCE (S256). The `state` value is random and
verified, and the cookie carrying it is signed with HMAC-SHA256 and compared in
constant time (`api/_oauth.ts`). The client secret is used in exactly one
place, server-side, and is never sent to the browser.

**Webhook verification**
`api/deauthorize.ts` verifies Zoom's `x-zm-signature` HMAC over
`v0:{timestamp}:{raw body}` in constant time, and rejects any request whose
timestamp is more than five minutes old.

**Dependencies**
One runtime dependency: `@zoom/appssdk`. Everything else is build- or
test-time (TypeScript, Vite, Playwright). A small surface, deliberately.

**Secrets**
Held as environment variables, never in the repository. `.env` is git-ignored;
`.env.example` documents the names only.

**Testing**
`npm run check` runs a typecheck, the state-machine assertions, and a real
browser run of the production bundle behind the production headers. It runs on
every push and pull request (`.github/workflows/check.yml`).

## Attestations to gather

These need evidence you hold, not code:

- Vulnerability handling: how a reported issue reaches you and how fast you
  respond. GitHub issues are the current channel — say so.
- Whether a penetration test or independent review has been performed.
- Confirmation that Deployment Protection is off for the production deployment
  (Zoom's webview cannot pass an SSO wall).
