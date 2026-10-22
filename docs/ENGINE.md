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

## 7. What this build deliberately does not do

* **No BPM/key analysis.** The planner supports it, the app does not ship a
  time-stretch/DSP stage, and pretending to beat-match without an analyser is
  worse than a clean crossfade.
* **No second music provider.** `sourcing.pdf` describes multi-provider
  resolution (JioSaavn DES media URLs, YouTube InnerTube impersonation and
  signature deciphering). VIBEX stays JioSaavn-only; its sourcing layer is a
  legal and operational liability this project does not want, and the value
  it offers the listener here is the *recovery* ladder, not the extra source.
* **No server-side ranker.** Candidate retrieval is the artist's top songs and
  a title search; ranking is local and explainable.
