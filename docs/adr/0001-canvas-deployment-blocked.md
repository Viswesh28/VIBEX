# 0001 — Canvas lookup is deployment-blocked: keep the code, correct the claim

* Status: **Accepted**
* Date: 2026-10-22
* Affects: the canvas layer (F-02), the capability matrix (F-01/F-11), the
  disclosure copy over rendered strings (F-15), PR #11

## Context

The canvas layer resolves a track to a `videoId` through a serverless lookup
(`api/canvas.mjs`) and shows a muted, looping clip behind the full player. Read
the policy in `src/lib/canvas.js` and the prose in `docs/ENGINE.md` §8.

From production, the lookup cannot resolve a clip. Measured on
`vibex-music-pi.vercel.app` on 2026-10-22:

| stage | result |
| --- | --- |
| InnerTube search, `music.youtube.com` | OK — `videoId` resolved |
| InnerTube player, `ANDROID_MUSIC` | `LOGIN_REQUIRED`, "Please sign in" |
| InnerTube player, `WEB_REMIX` | `LOGIN_REQUIRED`, "Sign in to confirm you're not a bot" |
| same two clients on `www.youtube.com` | identical |
| watch page HTML | 200, 1.2 MB, contains no media URLs (the same gate) |

The cause is the origin IP range: YouTube challenges automated clients from
cloud/datacenter addresses, and increasingly wants a PO-token attestation. This
is not a bug in the query, the client ladder, or the URL walker — those all
behave correctly and are covered by tests.

So the feature serves no listener, the artwork fallback does all the work, and
both the Settings toggle and the capability matrix implied canvas was
available. That misstatement is the actual defect: the lookup failing is a
provider fact, the app claiming otherwise is our bug.

## Decision

Keep the code. Stop advertising the capability. Report it as `blocked`, and let
a health probe re-enable it automatically if the challenge lifts.

Concretely:

1. `api/canvas.mjs` maps the challenge to `deployment_blocked`, distinct from
   `not_found` (a fact about the song) and `blocked_by_upstream` (a rate limit).
2. `GET /api/canvas?health=1` makes one cheap player call against a fixed video
   and answers `available` / `deployment_blocked` / `unknown`. It is cached for
   a minute when blocked and an hour when healthy, so an unblock is noticed
   quickly without polling.
3. `useCanvasVideo` asks the probe before any per-track lookup. When the
   deployment is challenged it sends nothing per track; the answer is shared
   per tab (30-minute TTL) so concurrent mounts cost one request, not several.
4. `canvasVideo` moves to `STATUS.blocked` with copy that names the reason and
   the fallback. The Settings note says the same thing in the same words.
5. `unknown` is treated as permission to ask once per track, never as a verdict
   in either direction: read as "available" it would waste a request per track,
   read as "blocked" it would hide clips that do exist.

## Rejected

* **Leave it as advertised.** Ships a false promise, and burns a request per
  track on a lookup that cannot succeed.
* **Delete the feature and close PR #11.** Removes the transport (a few lines)
  by discarding the matcher, ranking, gating, caching and fallback (the rest of
  the work), and gives up on self-healing. Only right if canvas is a non-goal.
* **Third-party or residential proxy.** Breaks the "no new providers" boundary,
  adds a paid dependency and a ToS escalation, and does not reliably work:
  YouTube challenges residential proxies too, so it is an arms race with no
  server-side end.
* **Move the lookup into the browser.** The user's IP is not gated, but the
  InnerTube endpoints do not send CORS headers for this origin, so the response
  is unreadable. Would need the same proxy in the end.

## Consequences

* The listener sees artwork, and the matrix says why. Nothing overpromises.
* A blocked deployment costs one probe request per tab per 30 minutes, and zero
  per-track requests.
* If YouTube stops challenging this deployment, the feature returns by itself —
  no release, no setting change.
* The prose in `docs/ENGINE.md` §8 and the copy asserted by
  `test/capabilities.spec.js` now have to agree; the test fails if the matrix
  ever marks canvas `available` again without the challenge being resolved.
