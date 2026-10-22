# 0002 — Canvas minted on device, from the track's own page

* Status: **Accepted**
* Date: 2026-10-22
* Supersedes, for canvas only: the "no device path" half of
  [ADR 0001](0001-canvas-deployment-blocked.md)
* Affects: the canvas layer (F-02), the capability matrix (F-01/F-11)

## Context

ADR 0001 established that the serverless lookup cannot fetch a canvas: YouTube
will not describe a **music track** to a client without a signed-in session,
which a Vercel function does not have, while plain videos resolve from the same
IP.

A WebView changes exactly that condition. It is a real YouTube client, on the
listener's own connection, running YouTube's own script, doing its own cipher
and n-transform. Whatever the page knows about a track — including the canvas
it renders — the page can be asked for.

## Decision

Ask the page, on the device, and use it as a **mint**, not a player.

* One offscreen `WebView`, reused for the whole app session (~100 MB and a cold
  start is not something to pay per track).
* It navigates the search page (the catalogue has no YouTube ids), resolves the
  first `videoId`, loads the watch page, and returns
  `ytInitialPlayerResponse` as JSON.
* The page is then paused and its timers stopped; it plays nothing, ever.
* All ranking stays in `pickCanvasUrl` (`src/lib/canvas.js`), the same walker
  the server path used, so "looks like a canvas" has exactly one definition.
  The minted answer is accepted **only** when the winning URL sits under a
  canvas key — a music video's `video/mp4` formats are not a canvas, and
  showing the official video where a loop belongs is the fake this project
  refuses.
* The URL is cached until its own `expire` says otherwise (minus five minutes),
  and a miss degrades to artwork with a typed reason.

### Why the Dart guide's shape, but not its code

The reference design was written for a Flutter app: `flutter_inappwebview`, a
Dart `MintController`, a WIT/WASM resolver contract, `exoplayer`. This app is
React + Vite inside a **Capacitor** Android shell, so the architecture ports and
the code does not:

| Guide | Here |
| --- | --- |
| `InAppWebViewController` | `CanvasMintPlugin.java`, a Capacitor plugin |
| `evaluateJavascript` | `WebView.evaluateJavascript` on the UI thread |
| Dart `MintController` | the plugin owns the single warm instance |
| `MintedStream` | `{ ok, blocked, response }` across the bridge |
| ranking in Dart | `pickCanvasUrl`, already tested in Node |

Splitting it this way keeps every decision on the JS side, where it can be
tested in CI. The native file does one thing: load a page and hand back what it
says.

### Scope: canvas only

The guide also describes a full `yt-webview` audio provider — a picker chip, an
`auto` order, minted audio streams, re-mint on 403. That is **not** in this
change. Canvas is the feature that was blocked, so canvas is what this unblocks;
audio still comes from JioSaavn exactly as before. The provider boundary is no
longer treated as permanent, but nothing here depends on it being lifted.

## What could not be verified

**There is no Android SDK, JDK, or Gradle in the build sandbox.** The Java file
has never been compiled. Everything around it is tested (26 specs on the mint
policy, 359 in the suite), and the seam is written so that the whole path is
inert — `canvasMintBridge()` returns null and the app falls back to artwork — if
the plugin is missing, throws, or returns anything unexpected.

Treat the native side as unreviewed code until a handset says otherwise. Three
things are worth checking first: whether the search page yields a `videoId`
without a session, whether the watch page exposes a canvas under
`ytInitialPlayerResponse`, and whether the 700 ms settle is long enough on a
slow connection.

## Consequences

* On Android, canvas has a path that can work for the first time; on the web it
  stays artwork, and the matrix says so in both directions.
* A mint costs a page load (2–5 s cold, cached warm) and only happens while the
  full player is open with Data Saver off.
* `deployment_blocked` remains the truthful verdict for the server route —
  removing the probe would just re-hide a real refusal.
* iOS is untouched: `WKWebView` blocks offscreen media, so the bridge reports
  absent rather than failing invisibly.
