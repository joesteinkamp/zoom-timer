# Meeting Timer — a Zoom App with a custom chime

A countdown timer that runs in the Zoom side panel. When it hits zero it plays
**one hardcoded chime** — not one of Zoom's presets — and plays it **into the
meeting**, so every participant hears it without installing anything.

Zoom already ships a countdown inside `setDynamicIndicator`, but its sound is
selected by `songChoice: number`, an index into Zoom's built-in sounds. There is
no way to hand it a file. That gap is the reason this app exists, and it splits
the work cleanly: **Zoom owns the shared visual, this app owns the audio.**

## How the chime reaches the meeting

`shareComputerAudio` pipes system audio into the meeting mix. It broadcasts
*everything* coming out of the machine for as long as it runs, so the share
window is kept as short as the chime — opened ~1s before zero, closed the
moment playback ends, with a watchdog in case `onended` never fires.

"Someone is sharing" is three different states, and they are handled
separately (`src/share.ts`):

| Situation | Behaviour |
| --- | --- |
| You're sharing with computer sound on | Already audible. `start()` is skipped rather than earning a `10132` |
| You're sharing, sound off | Advisory before the timer starts, plus a `promptShareScreen({shareSound: true})` shortcut |
| Someone else is sharing | Share refused (`10137`). Falls back to local audio; **everyone still sees the countdown** |

The badge needs no share slot, so every audio failure degrades to *"everyone
sees zero, some don't hear it"* — never to nothing happening.

## Layout

```
src/timer.ts       State machine. Absolute endsAt + monotonic runId.
src/audio.ts       Web Audio. Decodes the chime at boot, schedules on the audio clock.
src/share.ts       shareComputerAudio, serialized; screen-share coexistence.
src/indicator.ts   setDynamicIndicator lifecycle.
src/zoom.ts        SDK config, running context, capability detection.
src/main.ts        Controller wiring the above together.
api/install.ts     OAuth step 1 — PKCE challenge, signed cookie.
api/auth.ts        OAuth step 2 — token exchange, deeplink.
spike/             The M0 audio-share experiment.
test/logic.test.ts Timer and parsing tests.
```

### Two invariants worth not breaking

1. **Never accumulate.** Everything derives from an absolute `endsAt` and
   `Date.now()`. A `setInterval` that decrements a counter drifts; one that
   only repaints does not. A hidden webview gets throttled hard, so
   `timer.syncNow()` runs on every visibility restore and the fire condition
   is `now >= endsAt`, never "the callback ran".
2. **Every run carries a `runId`.** Async work started by a run captures its id
   and checks it is still current before acting. Without this, restarting a few
   seconds after the chime lets the previous run's watchdog close the *new*
   run's share, and the chime plays to nobody.

## Setup

### 1. Create the Zoom App

In the [Zoom Marketplace](https://marketplace.zoom.us/develop/create) build
flow, create a **General App** with the Zoom App (in-client) surface enabled,
user-managed. Then set:

| Field | Value |
| --- | --- |
| Home URL | `https://<host>/` |
| Redirect URL for OAuth | `https://<host>/api/auth` — note the `/api` prefix |
| OAuth Allow List | the same redirect URL |
| Domain Allow List | your app host |
| In-client features | enable every API listed in `CAPABILITIES` in `src/zoom.ts` |

Runtime `config()` is a second gate, not the only one — both lists must agree
or the call throws.

### 2. Run it

```bash
npm install
cp .env.example .env    # fill in from the build flow
npx vercel dev          # runs the client and the API functions
ngrok http 3000         # Home URL points at this
```

Enable webview devtools in the Zoom desktop client's advanced settings before
you start. Without them you are debugging a blank panel by print statement.

A free ngrok URL changes on every restart and has to be re-pasted into three
fields; a reserved subdomain pays for itself in the first afternoon.

### 3. Deploy

`vercel.json` carries the four security headers Zoom requires on the Home URL
response — `Strict-Transport-Security`, `X-Content-Type-Options`,
`Content-Security-Policy`, `Referrer-Policy`. **A response missing any of them
is blocked from rendering** in the embedded browser. This is also why GitHub
Pages cannot host this app: it exposes no header configuration, and a
`<meta http-equiv>` tag is not a response header.

Two Vercel defaults will cost you an afternoon if you miss them:

- **Deployment Protection.** Vercel Authentication is on by default for preview
  deployments. The Zoom webview cannot get through an SSO wall — it renders
  nothing, with no useful error. Turn it off for anything Zoom loads.
- **Preview URLs move per commit.** Zoom's Home URL and Redirect URL are fixed
  strings on the registration. Use the production domain, or point a second
  "dev" registration at a stable branch alias.

## The M0 experiment — do this first

`/spike` is a guided two-step protocol for the one test that cannot be
automated. Open it **inside the Zoom client**, in a real meeting, with a
second participant on the call:

1. **Play at your normal system volume.** Mark whether they heard it.
2. **Drop your system volume to ~10% and play again.** Mark whether it was
   noticeably quieter for them.

The page prints a result block — client version, running context, whether the
share opened and how fast, any refusal codes, and your two answers — ready to
paste back.

Question 2 is the one that matters. If loudness in the meeting tracks the
sharer's system volume, no amount of mastering fixes it, and it becomes a
documented limitation rather than a bug to chase. It cannot be determined
from the docs, and it changes what the app can promise.

Also worth ten minutes: whether the host setting *"Multiple participants can
share simultaneously"* lets an audio share coexist with someone else's screen
share. If it does, that is a one-checkbox fix for the most common failure
case.

## Verification status

```bash
npm run check   # typecheck + logic tests + end-to-end browser run
```

Three layers, all passing:

- **`npm run typecheck`** — `tsc --noEmit`.
- **`npm test`** — 33 assertions over duration parsing and the full state
  machine (start / pause / resume / extend / restart / reset / finish),
  including specifically that a stale `runId` cannot finish or tear down a
  current run.
- **`npm run e2e`** — serves the production bundle with the *exact* headers
  from `vercel.json` and drives the app in Chromium: a real 3-second timer
  through running → paused → firing → finished, then Restart, then starting a
  different duration straight from finished. It decodes the chime in a real
  browser and fails on any console error, CSP violation, or failed request.

  Serving the real headers is the point. This is what caught an inline `style`
  attribute that our own `style-src 'self'` refuses — it would have rendered
  the spike page unstyled inside Zoom and looked like anything but a CSP
  problem. Set `SHOTS=./shots` to also write screenshots.

**Not verified here, and unverifiable outside the Zoom client:** everything
that touches the SDK — audio share, the dynamic indicator, running-context
detection, and the OAuth install round trip. `zoomSdk.config()` needs the
client's JS bridge, `shareComputerAudio` needs a live meeting, and the volume
question needs a human on the other end. That is what M0 is for.

## Chime

`src/assets/chime.wav` is a three-note bell figure (C6–E6–G6) synthesized by
`tools/mkchime.py` — inharmonic partials with independent exponential decay,
normalized to −1 dBFS, trailing silence trimmed, 30 ms fade-out. 2.5 s.

Length matters beyond taste: the audio share stays open for the full duration
of playback, so a long tail is a longer window of your system audio going into
the meeting. Leading silence matters too — it delays the perceived fire and
reads as timer drift.

Replace the file and re-run the build to change the sound.
