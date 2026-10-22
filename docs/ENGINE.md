# Playback engine — transitions, recommendations and recovery

This is the implementation note for the behavioural upgrades: what the player
decides, where that decision lives, and what it deliberately does **not** do.

Everything in this document is enforced by tests. The pure functions carry no
React and no audio device, so they are cheap to reason about and cheap to
change.

| Module | Pure? | Tests |
|---|---|---|
| `src/lib/transition.js` | yes | `test/transition.spec.js` (29) |
| `src/lib/recommend.js` | yes | `test/recommend.spec.js` (21) |
| `src/lib/stream.js` | yes | `test/stream.spec.js` (17) |
| `src/lib/telemetry.js` | local buffer | exercised by `test/feed.spec.jsx` |
| `src/state/PlayerContext.jsx` | no — executes plans | `test/app.spec.jsx`, `test/session.spec.jsx` |

---

## 1. Crossfade

Three laws, selected in **Settings → Transitions** and stored in `svCfl`:

| Law | `g_out` | `g_in` | Use |
|---|---|---|---|
| Equal power (default) | `cos(e·π/2)` | `sin(e·π/2)` | two unrelated recordings — `g_out² + g_in² = 1` |
| Linear | `1 − e` | `e` | correlated material: the same recording, a stem, a reprise |
| Bass swap | equal power | equal power | plus a low-band hand-off, `bassSwapDb(e)` |

`e ∈ [0,1]` is the ramp position. The golden property for the equal-power law —
constant power across the whole ramp — is asserted in the test suite.

**Scheduling.** The ramp is driven by wall-clock elapsed time, not by a tick
counter, so a throttled tab cannot bend the curve. When a Web Audio graph is
available (the live-spectrum path), each deck has its own gain node and the
whole 64-point curve is scheduled ahead of time with
`AudioParam.setValueCurveAtTime`. When it is not — iOS, CORS-blocked CDN, or the
visualiser switched off — the player falls back to `element.volume`, which has
no automation lane. That fallback is why the code keeps two lanes:

* graph path: gain node = crossfade only, element volume = user volume
* element path: element volume = user volume × crossfade gain

Duration is 0–12 s. **0 is gapless, not a zero-length crossfade**: the next
track is cut in at the boundary with no ramp at all.

A manual skip never uses the configured blend — it uses a fixed 0.35 s
hand-over, because a DJ-style mix is a play-through behaviour and the user has
already asked for the next track.

## 2. The transition planner

`planTransition()` returns a plan, ordered cheapest-acceptable-first:

```
hard_cut → trim_silence → crossfade → filtered_crossfade → beat_matched → phrase_blend
```

The player executes the first four. `beat_matched` and `phrase_blend` are
implemented and tested in the planner but are **not** executed, because that
needs on-device tempo/key analysis of both tracks and this build does not ship
one. Rather than fake it, the planner reports the refusal: `no_analysis`,
`low_confidence`, `sequential_album`, `lossless_path`, `local_content`,
`tempo_mismatch`, `key_clash`, `manual_skip`, `crossfade_off`, `gapless_only`.

That list is the point. "We did not mix this pair" is data the UI can explain;
a silent downgrade is not.

Also implemented, tested, and ready for a future analyser:

* `camelotDistance(a, b)` — wheel distance; relative major/minor counts as 1,
  unreadable keys are `Infinity` and therefore incompatible.
* `pickPhraseBoundary(analysis, cfg)` — latest phrase start outside the
  drop-guard window.
* `canAutoMix()` — the explicit refusal gate.

## 3. The recommendation ladder

When a track ends there are exactly five things the player can do. The decision
is one pure function, `decideNext()`:

```
IN_CONTEXT → SMART_INSERT → AUTOPLAY_TAIL → SEED_RADIO → STOP
```

* **In context** — the next user track. Plain shuffle still randomises the
  index, but never mutates the list.
* **Smart insert** — budgeted, not vibes: one suggestion per 3 tracks, and
  only in a context longer than 15 tracks. The budget resets when a new
  playlist is loaded.
* **Autoplay tail** — similar songs after the user's own queue, marked as
  autoplay.
* **Radio** — a new seed when autoplay had nothing.
* **Stop** — with a typed reason.

Insertions live in a side channel. They are attached to the queue copy as
`_prov = { kind, reason }`, rendered with a badge, and never written into a
saved playlist. The reasons — `same_artist`, `playlist_cooccurrence`,
`audio_similarity`, `editorial`, `context` — are what the badge says, so the
listener can see *why* a song appeared.

`pickCandidate()` filters dismissed ids, ids already queued, and songs with no
stream, then scores same-artist, duration proximity and shared album. Skipping
before 30 s is treated as a strong negative; an explicit dismiss is honoured
for 30 days across sessions (`svDismissed`).

**Typed stop reasons** (`context_exhausted`, `autoplay_failed`,
`format_negotiation_failed`, `entitlement_lapsed`, `content_not_playable`,
`client_too_old`, `unknown`) mean "the queue finished" and "the recommender had
nothing" reach the UI as different messages with different recovery actions.

## 4. Home feed

* Each shelf loads independently; a failed shelf is dropped, not fatal.
* Loading renders fixed-height skeleton shelves, so the page does not reflow.
* A first-page failure gets at most two retries with jittered, capped backoff.
* Every degrade emits `home.degraded` / `home.failed`, because silent
  degradation is invisible without an event.

## 5. Stream recovery

Failures are classified before they are acted on (`classifyMediaError`):
`aborted`, `network`, `decode`, `format_negotiation_failed`, `stale_url`,
`unknown`.

The ladder: refresh a signed URL that is past its `expire`, retry a transport
error once, drop one quality tier on a decode/codec failure, then skip with a
typed reason. An automatic downgrade survives reloads but is cleared the moment
the listener picks a quality themselves.

## 6. Telemetry

`src/lib/telemetry.js` is a 200-event ring buffer plus a `CustomEvent`
(`vibex:telemetry`). Nothing leaves the device; there is no endpoint and no
analytics dependency. The vocabulary is intentionally small: `home.degraded`,
`home.failed`, `home.loaded`, `recommend.impression`, `recommend.dismissed`,
`recommend.skipped_early`, `autoplay.failed`, `transition.planned`,
`transition.fallback`, `stream.recovered`, `stream.failed`.

## 7. Taste, resume, privacy, sleep

Four small pieces of state that make the player feel like it remembers you,
each deliberately kept in its own module so it can be tested without a DOM.

### `src/lib/taste.js` — the local ranker

`buildTaste(stats, { excluded })` turns the on-device `svStats` blob into a
weighted artist map. Two properties matter:

* **Completion beats plays.** `songWeight` multiplies a play by the share of
  the track actually heard (`sec / dur`), with a skip under 15% counting for
  `0.3×`. A track left running while the phone is in a pocket should not
  outweigh one listened to.
* **Recency decays.** `recencyWeight` is a 14-day half-life computed from the
  entry's `last` timestamp, so this month's taste outranks last year's.

`rankByTaste` then filters candidates — dismissed, already queued, played in
the last 3 days, excluded artists, no stream URL — and sorts by affinity.
`pickSeeds` takes the top three artists, and the "For you" view fetches their
top songs and ranks them. Every ordering decision is in this one module; the
view only fetches and renders.

### `src/lib/sleep.js` — the fade

The sleep timer no longer cuts playback dead. `sleepGain(elapsed, total)` is an
equal-power cosine ramp over the last `SLEEP_FADE_SEC` (20s), returning exactly
`1` outside the window and exactly `0` at the end — the exact-zero case is
special-cased because `cos(π/2)` is `6.1e-17`, not zero, and a non-zero floor is
audible as a click plus a tiny leak of sound after "stop". The gain is a third
volume lane on top of user volume and the crossfade curve, applied through a
single `writeVol` helper so a crossfade tick cannot overwrite the fade.

### Resume with a position

`svSession` stores the queue; `svResume` stores `{ id, pos, dur, at }` on a 5s
tick and whenever the page is hidden or unloaded. On boot the playhead is only
restored if the saved id matches the track the queue is sitting on, the entry is
under 7 days old, the position is past 5s, and it is not within 2s of the end.
Restoring still leaves playback paused: a reload must not start making noise.

### Privacy controls

* **Private session** (`svPrivate`) — `LibraryContext` short-circuits its
  recording path, so plays, seconds, recency and artist credit are all skipped.
  The internal flush clock keeps advancing, so a later public session does not
  inherit one enormous unattributed chunk of time.
* **Excluded artists** (`svExcluded`) — a name list consulted by `buildTaste`,
  `rankByTaste` and the "For you" chips. An excluded artist contributes zero
  weight rather than negative weight, so excluding does not distort the rest of
  the profile.
* **Reset history** — removes `svStats` only. Likes and playlists are separate
  keys and survive; the destructive action is two-step in the UI because it
  cannot be undone.

## 8. Capability honesty

`src/lib/capabilities.js` is the single place that answers "can VIBEX do this?".
It exists because the honest answer changed shape: the app has **one source**
(JioSaavn), so a capability list is a statement about that source, not a
picker that swaps providers.

The matrix has five states — `available` (the catalogue serves it), `strength`
(better here than in a cross-source player), `local` (needs work that has not
shipped), `unavailable` (no setting and no second source would produce it), and
`blocked` (the code ships and would work, but this deployment is refused by the
provider — see the canvas section below).
Rendered in Settings as a scannable list: a claim on each row, and the
justification only on rows where it explains an absence.

Two entries are `unavailable` and are asserted as such by
`test/capabilities.spec.js`:

* **Lossless** — Saavn caps at 320 kbps AAC. A `Lossless` preference would be
  a label with nothing behind it.
* **Skip silence** — the catalogue publishes no segment data, and the app does
  not analyse audio to find gaps.

### Canvas video is the one cross-source capability

The catalogue has no video, so the clip is looked up on **YouTube Music** while
the audio stays on JioSaavn. `src/lib/canvas.js` owns the policy and
`api/canvas.mjs` owns the one network hop; the split keeps the decision
testable without a socket.

The policy is deliberately conservative, because this is the only feature that
spends a second provider's bandwidth:

* fetched **only** while the full-screen player is open (`canvasDecision`);
* never asked for under **Data Saver**, which would be a second download;
* an explicit off switch (`svCanvas`), reported before Data Saver in the reason
  so the UI never blames the wrong cause;
* results cached per song in memory and `sessionStorage`; **negative** results
  are not persisted, since a block may be transient;
* every failure is typed (`not_found`, `blocked_by_upstream`,
  `deployment_blocked`, `lookup_failed`) and degrades to artwork. A broken clip
  is cosmetic; a hanging request is a broken song.

The canvas field in InnerTube is undocumented and has moved between client
versions, so `pickCanvasUrl` walks the whole response and ranks candidates
instead of hard-coding a path, and refuses any URL that is not https on a
Google media host, or that looks like a thumbnail.

#### The lookup is blocked from this deployment

Measured on the live production function on 2026-10-22. Search works — it
resolves a `videoId` for every query tried. The player call does not:

| probe | result |
| --- | --- |
| music track (`Gehra Hua`, `Blinding Lights`), `ANDROID_MUSIC` | `LOGIN_REQUIRED`, "Please sign in" |
| same tracks, `WEB_REMIX` | `LOGIN_REQUIRED`, "Sign in to confirm you're not a bot" |
| either client, on `music.youtube.com` and `www.youtube.com` | identical |
| watch page for those ids | 200, ~1.2 MB, no media URLs (same gate) |
| **plain UGC video, same server, same IP** | **`streamingData` returned** |

That last row is the one that matters: the deployment is not firewalled off
from YouTube. The block is about origin, not content — an unauthenticated client
is served music tracks from a residential address and challenged from a
datacenter one. `?recipe=1` reproduces `sigma67/ytmusicapi`'s exact request
shape (today's client version, public API key, visitor id, `base.js`
signature timestamp) and is refused identically, so the request is not what is
wrong. See ADR 0001. Canvas metadata only exists on music
tracks, so the clip cannot be fetched here — not by changing the query, the
client version, or the host.

The feature is therefore reported as `blocked`, not `available`, and not
silently deleted:

* `api/canvas.mjs` distinguishes the refusal (`deployment_blocked`) from a track
  that simply has no clip (`not_found`), because they are different facts and
  only one of them is about the song;
* `GET /api/canvas?health=1` asks the same question the feature would — search,
  then a player call on a **music** track — and caches the answer for a minute
  when blocked, an hour when healthy. Probing with a plain video would answer
  "available" and then waste a request per song, which is the failure mode this
  endpoint exists to prevent;
* `useCanvasVideo` consults that answer before any per-track request, so a
  blocked deployment costs **zero** lookup requests per track; the answer is
  shared per tab and re-checked every 30 minutes, which is what lets the
  feature switch itself back on if the requirement ever goes away;
* the matrix row and the Settings note say it needs a signed-in session, in
  those words, and the full player shows artwork.

This is the honest shape of the trade: the matcher, ranking, caching, gating
and fallback are all correct and tested, and none of them are advertised as
delivering something the deployment cannot. Unblocking it would mean holding a
YouTube session on the server, which is precisely the provider impersonation
this project has refused from the start.

#### A second route, on the device

The server verdict above is final for the web build. The Android shell is not
gated the same way, because a WebView is a real client on the listener's own
connection running YouTube's own script — so it is asked directly.

`CanvasMintPlugin.java` keeps one offscreen WebView for the session, navigates
the search page to resolve a `videoId`, loads the watch page, and returns
`ytInitialPlayerResponse` as JSON. It never plays anything. The ranking is
`pickCanvasUrl` again, and a URL is accepted only when it sits under a canvas
key: a music video is not a canvas, and substituting one would be the fake this
project refuses. See `docs/adr/0002-canvas-mint-on-device.md`.

`canvasMint.js` owns that policy and is fully tested without a device; the
plugin is selected only on Android native, and the whole route collapses to
artwork if it is missing. **The Java has not been compiled** — this repository's
build environment has no Android SDK — so the native half is unreviewed until it
runs on a handset.

The local visualiser is unaffected by any of this, and it is what Data Saver
still leaves alone: the rule there is **gate the fetch, not the display**, and
a canvas drawn on-device has no fetch. A local canvas costs no bytes, so hiding it under Data Saver would
remove a feature and save nothing. `describeVisual()` returns the reason a
visual is in its current state (`user_disabled`, `live_audio`, `live_audio_
unavailable`, `style_simulated`) plus `dataSaverApplies: false`, so the panel
can explain the decision instead of leaving a mystery gap.

The spec also carries a copy test over `src/components`: every mention of
lossless, skip-silence or canvas video in a rendered string must be a denial
(`no`, `not`, `n't`, `never`, `unavailable`). Prose and engine internals are
exempt — `transition.js` legitimately holds a `lossless` flag, used to *refuse*
auto-mixing on that path rather than to claim a mix.

### Two sources, one of which cannot play here

The listener can choose JioSaavn or YouTube Music (`svSource`, default
JioSaavn). The choice is real, but the two are not interchangeable and the app
never pretends otherwise: YouTube Music supplies a **catalogue** (search answers
this deployment) while its **audio** is refused (ADR 0001). `src/lib/sources.js`
holds the whole policy — `cataloguePath`, `mapYtResult`, `playbackPlan` — and the
player prints the reason it refuses rather than a generic failure. See ADR 0003.

### The device mints YouTube audio; the server still does not

ADR 0001 stands: no server-side session, no proxy, no residential relay. What
changed in ADR 0004 is *where* the mint happens. The Android app loads the watch
page in the offscreen WebView it already owns for canvas, lets the page's own
player do the signature decipher and `n` transform, reads the resulting
`googlevideo` URL off the network layer, and hands it to the existing
`<audio>` deck. The page is then thrown away.

Three rules hold that together, all in `src/lib/ytStream.js`:

* **A URL is not accepted until it has been range-probed.** A one-byte request
  says what total the server will serve; a request for the last kilobyte is what
  a preview URL refuses. A minted URL that fails is a typed failure with its own
  sentence, never a track that stops 61 s in.
* **Only audio-only formats.** A muxed `video/*` rendition would play sound and
  also stream several times the bytes; a track with no audio-only format is
  refused rather than downgraded.
* **One re-mint, ever.** A dead URL gets a second attempt because that is
  latency. A bot challenge, a preview, or a page that fetched nothing is
  terminal — a fallback to JioSaavn is the success case, and repeat mints are
  what get an address flagged.

On the web the mint needs the **helper extension** (`extension/`), because a
page cannot reach either endpoint: the player API 403s a foreign `Origin`
including the preflight, and `googlevideo` grants CORS only to YouTube's own
origins — so a page can *play* a minted URL but cannot *probe* it, which would
ship exactly the truncation bug the gate exists to catch. The extension runs the
same harvest in a hidden tab at `document_start` (real injection, which Android
could not do) and probes from its service worker, where host permissions bypass
CORS. The app's logic is unchanged: one seam, one gate. See ADR 0005.

Without the extension, web stays browse-only — and the picker says which of the
three situations applies rather than a blanket refusal.

The choice itself lives in the **sticky top bar**, not in the song results: with
it beside the results, a listener only discovered the app had two catalogues
after searching, and a listener on the home feed never discovered it at all.
While YouTube Music is selected a slim banner states the limit in the same
sentence the capability matrix and Settings use (`BROWSE_ONLY_NOTE`) and offers
the one-tap way back to JioSaavn, so the warning carries its own fix.

## 9. What this build deliberately does not do

* **No BPM/key analysis.** The planner supports it, the app does not ship a
  time-stretch/DSP stage, and pretending to beat-match without an analyser is
  worse than a clean crossfade.
* **No second *playable* provider.** `sourcing.pdf` describes multi-provider
  resolution (JioSaavn DES media URLs, YouTube InnerTube impersonation and
  signature deciphering). VIBEX offers a second *catalogue* (YouTube Music) and
  refuses its audio, because minting it needs a session from a residential
  origin — a legal and operational liability this project does not want. The
  value on offer is the *recovery* ladder plus a way to find a track, not a
  second stream.
* **No server-side ranker.** Candidate retrieval is the artist's top songs and
  a title search; ranking is local and explainable.
