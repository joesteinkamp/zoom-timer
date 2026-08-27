# Marketplace listing copy

Draft copy for the submission form. Everything here is written to match what
the code actually does — if behaviour changes, this changes with it.

**Not yet answerable:** every claim about how the chime *sounds* to other
participants depends on the M0 result. If loudness in the meeting tracks the
sharer's system volume, add that to "Limitations" before submitting.

---

## Name

Meeting Timer

## Short description (under 100 characters)

> A shared countdown for your meeting, with a chime everyone hears at zero.

## Long description

> Meeting Timer keeps a meeting to time without anyone having to watch a clock.
>
> Start a countdown from the Apps panel and it appears next to your name in
> every participant's client — drawn by Zoom itself, so nobody needs to install
> anything or watch your screen. When it reaches zero, a chime plays into the
> meeting so the room hears it, not just you.
>
> Pick a preset or type any duration. Pause it, add a minute, restart it. The
> countdown is exact: it works from a fixed end time, so it stays honest even
> if you switch away and come back.
>
> Zoom's own countdown can only play sounds from its built-in list. This app
> exists to bring its own — one clear bell figure, audible to everyone, without
> a screen share.
>
> **Requires the Zoom desktop client for Windows or macOS.** Version 5.12.6 or
> later for the chime, 5.17.5 or later for the shared countdown badge. On
> mobile and web the timer runs for you alone — Zoom does not offer audio
> sharing or the countdown badge there.

## Category

Productivity

## Key features (three bullets)

- **Everyone sees it.** The countdown appears next to your name in every
  participant's client, with no screen share required.
- **Everyone hears it.** At zero the app briefly shares computer audio so the
  chime reaches the meeting, then closes the share immediately.
- **Nothing is collected.** No accounts, no database, no analytics. The only
  thing stored is your last countdown length, in your own browser.

## Permissions and why

| What the app asks for | Why |
| --- | --- |
| Run as a Zoom App in meetings | It is a meeting tool; the panel is the whole app |
| Share computer audio | The only way to make a custom sound audible to the meeting |
| Set a dynamic indicator | Draws the countdown badge next to your name |
| Read meeting context | Labels the badge with the meeting topic |
| Read user context | Checks whether your role may share audio in a webinar, and tells your own screen share apart from someone else's |

## Limitations to state plainly

- Desktop only. Audio sharing does not exist on mobile or web clients.
- If another participant is already sharing, Zoom gives them the audio channel;
  the chime plays locally and the countdown badge still works for everyone.
- A host or administrator can disable computer audio sharing entirely.
- While the chime plays, all computer audio is shared — the app says so before
  the first timer.

## Screenshots to capture

All need a real meeting; none can be taken outside the Zoom client.

1. The panel with a countdown running, in the side panel at its real width.
2. The countdown badge next to a participant's name in the meeting — the
   single most convincing image in the listing.
3. The audio notice as a first-time user sees it.
4. The advisory state: "You are sharing without sound", with the one-click fix.

## Support and legal URLs

| Field | URL |
| --- | --- |
| Documentation | `https://<host>/docs/` |
| Support | `https://<host>/support/` |
| Privacy policy | `https://<host>/privacy/` |
| Terms of use | `https://<host>/terms/` |
| Deauthorization endpoint | `https://<host>/api/deauthorize` |

## Icon

`brand/icon-180.png` and `brand/icon-512.png`, generated from `brand/icon.svg`
by `node tools/mkicon.mjs`.
