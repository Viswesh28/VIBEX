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
| **plain UGC video, same server, same IP** | **`streamingData` returned** |

That last row rules out the first theory. A datacenter IP is not refused
outright, so this is not an egress or IP-reputation problem: YouTube will not
describe a **music track** to a client without a signed-in session, and it says
so with `LOGIN_REQUIRED`. Ordinary videos resolve from the same machine.

Canvas metadata only exists on music tracks, so the clip cannot be fetched
here — not by changing the query, the client ladder, or the host. Those are
correct and covered by tests; there is nothing left to tune.

So the feature serves no listener, the artwork fallback does all the work, and
both the Settings toggle and the capability matrix implied canvas was
available. That misstatement is the actual defect: the lookup failing is a
provider fact, the app claiming otherwise is our bug.

### Corroboration, and a correction (2026-10-22)

`sigma67/ytmusicapi` is the most widely used unauthenticated YouTube Music
client, and it is a better control than anything written here. Reading it, then
porting its exact request shape into `api/canvas.mjs` (`?recipe=1`) and running
it from the same deployment:

| element | ours, before | ytmusicapi's recipe | result here |
| --- | --- | --- | --- |
| client version | hardcoded `1.20240701.00.00` | `1.<today>.01.00` | today's date used |
| API key | none | public web key | sent |
| `alt=json` | none | yes | sent |
| visitor id | none | read from page `ytcfg` | `present` |
| `signatureTimestamp` | none | parsed from `base.js` | `20745` |
| **player response** | `LOGIN_REQUIRED` | — | **`LOGIN_REQUIRED`** |

So the block is **not** the shape of our request. Matching the reference client
exactly changes nothing: the deployment is still asked to sign in.

Two further facts pin down the mechanism:

* ytmusicapi's own test suite asserts `streamingData` on an **unauthenticated**
  `get_song` — but skips that assertion on GitHub CI, with the comment
  *"skip assert on GitHub CI because it doesn't work for some reason"*. CI is a
  datacenter IP, like this deployment.
* The same unauthenticated call is expected to work from a normal connection.

This **corrects** the earlier claim in this ADR that the requirement is simply
"signed-in only for music tracks". The accurate statement is narrower and more
awkward: an unauthenticated client is served music tracks from a residential
address and challenged from a datacenter one. It is reputation and origin, not
a rule about the content. The remedy is therefore the same either way — ask
from where the listener actually is — which is what an on-device WebView does
(see [ADR 0002](0002-canvas-mint-on-device.md)). It also means 0002's route has
a materially better chance than anything that ran on this server.

`ytmusicapi` supplies no canvas support to copy: the word appears nowhere in the
codebase, and `get_song` strips the response to five keys
(`videoDetails`, `playabilityStatus`, `streamingData`, `microformat`,
`playbackTracking`), deleting any canvas data it was handed.

## Decision

Keep the code. Stop advertising the capability. Report it as `blocked`, and let
a health probe re-enable it automatically if the challenge lifts.

Concretely:

1. `api/canvas.mjs` maps the challenge to `deployment_blocked`, distinct from
   `not_found` (a fact about the song) and `blocked_by_upstream` (a rate limit).
2. `GET /api/canvas?health=1` runs the same path the feature runs — search,
   then a player call on a **music** track — and answers `available` /
   `deployment_blocked` / `unknown`. It is cached for a minute when blocked and
   an hour when healthy, so a change is noticed quickly without polling.
   (The first version of this probe used a plain video and duly answered
   "available": probing with something the server *can* fetch measures the wrong
   thing, and would have spent a request per track to learn nothing.)
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
  adds a paid dependency and a ToS escalation. It also would not fix this one:
  the refusal is about authentication, not address, so a proxy with no YouTube
  session is refused the same way.
* **Move the lookup into the browser.** The listener's browser is no more
  signed in than the server, and the InnerTube endpoints do not send CORS
  headers for this origin, so the response is unreadable anyway.
* **Hold a YouTube session server-side** (cookies or a PO token). That is
  provider impersonation, which this project has refused since the sourcing
  decision; it would also fail unpredictably and expire silently.

## Consequences

* The listener sees artwork, and the matrix says why. Nothing overpromises.
* A blocked deployment costs one probe request per tab per 30 minutes, and zero
  per-track requests.
* If YouTube ever describes music tracks without a session, the probe notices
  and the feature returns by itself — no release, no setting change. The honest
  expectation is that it will not, since the requirement is deliberate.
* The prose in `docs/ENGINE.md` §8 and the copy asserted by
  `test/capabilities.spec.js` now have to agree; the test fails if the matrix
  ever marks canvas `available` again without the challenge being resolved.
