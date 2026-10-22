# 0005 — The web needs an extension, and that is a platform fact

Status: **accepted**. App seam landed and tested; the extension itself is
**untested** (no browser in the build environment).

## The question

ADR 0004 mints YouTube audio from a WebView on Android. The obvious next
question is why the same code cannot run in a website. It cannot, and the reason
is not YouTube's bot check — it is the browser's own security model. Two
independent barriers, either of which is fatal on its own:

### 1. The player endpoint refuses foreign origins

`POST https://music.youtube.com/youtubei/v1/player` answers **403** to a request
carrying a foreign `Origin`, and that includes the CORS preflight, so the browser
never sends the POST at all. This is widely observed:

* `youtubei/v1/player answers any request carrying a foreign Origin with 403,
  including the CORS preflight` — this is exactly what a *static page* hits when
  it tries to resolve a video client-side.
* A Chromium desktop client hits the same wall from the other side: the
  `Content-Type: application/json` POST triggers `OPTIONS`, YouTube 403s it, and
  the app sees `TypeError: Failed to fetch`.
* Browser-side InnerTube clients are repeatedly documented as not working for
  this reason: "YouTube's API doesn't include CORS headers … Browsers block the
  request before it completes."

### 2. `googlevideo` grants CORS to YouTube's origins only

Even with a URL in hand, a page cannot read it:

* `googlevideo sends Access-Control-Allow-Origin only for https://www.youtube.com.
  Other origins get none, so the browser refuses to hand over the bytes.`
* The same conclusion, older: `*.googlevideo.com has probably only whitelisted
  youtube.com, hence allowing only network requests from youtube.com host.`

That second barrier matters more than it looks. A page *can* put a `googlevideo`
URL in an `<audio>` element and hear it — media elements are exempt from CORS for
playback. But it cannot `fetch` it, so it cannot read `Content-Range`, so it
**cannot run the validity gate**. It would be shipping the exact bug ADR 0004
exists to prevent: a URL that looks fine, plays, and stops 61 seconds in.

## The decision

Keep the seam, and give the browser the one thing it lacks: an extension.

`streamMintBridge()` in `music-app/src/lib/ytStream.js` now returns either the
Android plugin **or** `window.__VIBEX_STREAM_MINTER`, with the same contract
(`mintStream({videoId}) → payload`). Every decision — format choice, the
validity gate, TTL, one-re-mint — stays in the app and stays unit-tested. The
extension only observes and reports.

`extension/` implements it:

* `yt/harvest.js` runs at **`document_start` in the page world** of
  `music.youtube.com` — real injection, which is the one thing Android could not
  do without `androidx.webkit`. Same shim: `XHR`, `fetch`, `addSourceBuffer`.
* `background.js` opens the watch page in a **hidden tab**, polls the harvester,
  runs the two range probes (its host permissions bypass CORS, which is why the
  probe lives there and not in the page), and closes the tab.

That is the WebView pattern, in the place where the credentials already are: the
listener's browser, on the listener's connection. No server session, no relay, no
proxy — ADR 0001 is untouched.

## Rejected

* **A relay or CORS proxy**, including "just for the API call". It is a
  server-side resolver by another name, it moves the mint to a datacenter
  address, and the resulting URL would be signed for the wrong IP.
* **Calling InnerTube from the page and hoping.** Measured above: 403, twice.
* **Playing a `googlevideo` URL without the gate.** Plays, then truncates, and
  the failure is indistinguishable from a network problem.
* **A public Invidious/Piped instance as a "third source".** A third-party proxy,
  which is the thing ADR 0001 rejected.
* **Shipping the extension's logic in the web bundle.** It cannot work there, and
  a code path that always fails is worse than an honest absence.

## Honest limits

* The extension is **not installable from a store** yet — unpacked only.
* **Not verified**: no browser in the build environment, so nothing under
  `extension/` has been executed. The app side it talks to is tested; the
  messaging and the tab dance are not.
* A **bot challenge is inherited, not defeated**. `blocked` is terminal.
* The **visualizer degrades to simulated mode** for minted audio: cross-origin
  media taints the Web Audio graph. Playback and seeking are unaffected; the app
  already has that fallback and prints it.
* Tracks with **no audio-only rendition are refused**, never played as video.

## Consequences

* `sources` stays `blocked` with the claim **"browse only on the web"**. Still
  true, with or without the extension installed — the website alone cannot.
* The refusal copy now names both ways to get YouTube audio (Android app, browser
  extension) instead of just "choose JioSaavn".
