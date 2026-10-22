# 0003 — A second source, and what it can actually do

* Status: **Accepted**
* Date: 2026-10-22
* Affects: the source setting, search, the player's failure copy, the capability
  matrix. Relates to [ADR 0001](0001-canvas-deployment-blocked.md) (why YouTube
  audio is refused here) and [ADR 0002](0002-canvas-mint-on-device.md) (the
  device route that is built but unconfirmed).

## Context

The listener asked to choose between JioSaavn and YouTube Music. That reverses
an earlier boundary — "one source, no picker, no automatic mode" — which was
correct while there was exactly one source worth offering. The boundary is now
lifted, so the question becomes what a picker may honestly claim.

Earlier work established, by measurement, that the two sources are not
symmetric:

| | JioSaavn | YouTube Music |
| --- | --- | --- |
| catalogue (search, browse) | works | **works** — InnerTube search answers this deployment |
| audio stream | works | **refused** — `LOGIN_REQUIRED` from a datacenter address |

## Decision

Offer the choice, describe the limit in the same breath, and never let the
picker imply the audio works.

* `svSource` stores `jiosaavn` (default) or `ytmusic`; anything unrecognised
  falls back to JioSaavn so a stale value cannot leave the app sourceless.
* `api/ytmusic.mjs` serves the **catalogue only**. It does not pretend to
  resolve a stream, because on this deployment it cannot.
* `src/lib/sources.js` maps a YouTube result into the same track shape the rest
  of the app already reads (`artistsOf`, `imgOf`, `streamOf`), with an **empty
  `downloadUrl`** — the honest value, and the one the player already treats as
  unplayable.
* `playbackPlan()` returns a typed reason per platform, and the player prints it
  instead of the old catch-all "No stream URL for this song." A refusal now says
  which source will work.
* The rows carry a small `YT` badge, and the source chips sit with the results
  rather than only in Settings, because switching is something you do mid-search.
* The capability matrix gains a `blocked` row for the second source, claiming
  "browse only" in as many words.

## Rejected

* **Ship the picker and let playback fail generically.** That is the defect this
  project keeps fixing: a dead end with no diagnosis.
* **Fake a stream for YouTube results.** No.
* **Hide YouTube Music until audio works.** Then there is no choice to offer,
  which is the thing being asked for. Browsing is genuinely useful — it is how
  you find out a track exists before switching to play it.
* **Resolve YouTube audio server-side anyway.** Measured and documented in ADR
  0001; matching the reference client's request exactly changes nothing.

## Consequences

* A listener can search YouTube Music and is told, at the point of refusal, that
  JioSaavn will play.
* Nothing in the app claims YouTube audio works. The matrix, the Settings note,
  the search note and the player message all say the same thing in the same
  words, and `test/sources.spec.js` asserts it.
* The next honest step, if the choice should include playback, is the on-device
  mint (ADR 0002's mechanism, extended from canvas to audio) — not a server.
