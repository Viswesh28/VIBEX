# 0004 — YouTube audio is minted on the device

Status: **accepted**, implementation landed, **not yet run on a device**

## The problem

ADR 0001 measured the server-side canvas lookup as blocked: YouTube answers
`LOGIN_REQUIRED` for a music track to a datacenter address with no session, and
ADR 0003 shipped YouTube Music as a catalogue-only second source because of it.
Two consequences followed:

* YouTube Music results could be browsed but never played on any surface.
* Canvas video was `deployment_blocked` and advertised as unavailable.

Both were attempts to ask YouTube a question from the wrong side of the wire.

## The decision

Ask the device instead. The Android app already owns a WebView for the canvas
mint (ADR 0002). It now also mints a **stream URL** from the same page:

1. Load the watch page for the video id, offscreen, reused across tracks.
2. Read `ytInitialPlayerResponse.streamingData.adaptiveFormats` and take an
   audio-only format (opus 251 → 250 → 249 → AAC 140 → 139, then best bitrate).
   A response that still carries direct URLs needs no playback at all.
3. If the response is cipher-only, start the page **muted** and read what it
   fetched: `XMLHttpRequest`/`fetch`/`MediaSource.addSourceBuffer` are wrapped so
   the captured `googlevideo` URLs are visible. Those URLs already carry the
   deciphered signature and the transformed `n`, because the page's own player
   did that work.
4. **Range-probe the URL** before it is used, then hand it to the existing
   `<audio>` player and discard the page.

Nothing about the server changes. There is still no server session, no proxy,
no residential relay, and no server-side stream route — the boundary ADR 0001
drew is intact, and this is why the boundary could be kept: the work moved to
where the credentials already live, which is the listener's own device.

### Why not `document.querySelector('video').src`

It is the obvious reading and it does not work on `music.youtube.com`: the
player feeds a `MediaSource`, so the element carries a `blob:` URL and never a
`googlevideo` one. Polling it returns nothing for six seconds and then times
out. The network layer is the correct seam, because under MSE the segment
requests are still XHR/fetch.

## The gate, which is the part that matters

A 200 on a `googlevideo` URL proves nothing. Some clients are handed a ~1 MiB
prefix of the file — measured at 1 040 807 B for a 268 s track, about 61 s of
audio. It plays perfectly and then stops, which to a listener is a network
hiccup and to a maintainer is a week.

So a minted URL is only used after two ranged requests:

| probe | asks | a preview answers |
| --- | --- | --- |
| `bytes=0-0` | what total will you serve? (`Content-Range`) | a fraction of the declared length |
| last 1 KiB | can the end of the file be reached? | `403` |

Plus a bitrate × duration sanity check for the case where the URL declares no
length at all. The verdict is `validateProbe` in `music-app/src/lib/ytStream.js`
— pure, no I/O, and unit-tested against the measured preview fixture. A URL
that fails is a typed failure, never a silent 60-second truncation.

## Normalisation

Captured URLs are *segment* URLs. `range`, `rn`, `rbuf` and `rbum` pin a byte
window and are stripped, along with duplicate params; `expire`, `ip`, `sig`,
`n`, `pot` and `sparams` are copied through untouched, because they are the
reason the URL works and because the signature is bound to the minting address.

## Retry discipline

`bot_challenge`, `no_direct_audio`, `no_hits` and a preview are **terminal**: a
fallback is a success, and looping mints is how a listener's address gets
flagged, which is the one failure this approach cannot recover from. A URL that
comes back dead (403/410) gets **exactly one** re-mint, because that is usually
latency rather than policy.

`expire=` is honoured as `min(expire − 5 min, 4 h)`, and the cache is cleared on
a network change, because `ip=` is part of the signature: a URL minted on Wi-Fi
is a 403 on cellular before its own expiry says anything is wrong.

## Rejected

* **Server-side session or proxy.** The whole point of ADR 0001; unchanged.
* **Playing inside the WebView.** Inherits ads, 3–5× the bytes as video, no
  lock-screen controls, and the page is suspended when backgrounded.
* **Reading the `<video>` element.** Does not work under MSE; see above.
* **Streaming a muxed `video/*` rendition when no audio-only format exists.**
  That is the defect this project keeps fixing — it would stream four times the
  bytes into a player built for audio. Such a track is refused instead.
* **A loopback range proxy.** Mistaken for portability. The Android player can
  send `Range` itself, so the windowing belongs in the client, not in a local
  socket that needs a cleartext exception and can outlive a session.
* **Retrying a challenge or a preview.** See retry discipline.
* **Downloading.** Nothing here writes a file or re-containers a stream; it is a
  client that plays, not a ripper.

## What is verified, and what is not

Verified in CI:

* `validateProbe` rejects the measured preview by declared length, by tail
  availability, and by bitrate × duration.
* `normalizeCapturedUrl` strips range plumbing, keeps the signature and drops
  duplicates.
* Exactly one re-mint on a dead URL; zero retries on a challenge or a preview.
* Cache honours `expire`, and a network change clears it.
* `streamMintBridge` is absent on web and on iOS.

**Not verified — this is the honest gap:** the Java half
(`CanvasMintPlugin.mintStream`) has never been compiled or run. This environment
has no Android SDK, and the feature needs a real device with a real network
anyway. The first device run should confirm, in order: that
`streamingData` arrives with audio formats at all; that the shim catches requests
when injected from `onPageStarted` (Android has no document-start hook without
`androidx.webkit`, which this project does not depend on — if the shim misses,
path 1 still answers, and adding that dependency is the documented next step);
that both probes return `206`; and that a full track plays end to end.

## Consequence for the capability matrix

`sources` stays `blocked`, but the claim is now precise: *browse only on the
web*. The device can mint; a browser tab has no page to mint from. That is the
same sentence ADR 0003 wanted, narrowed to the surface where it is true.
