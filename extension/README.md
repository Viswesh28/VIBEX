# VIBEX stream helper (browser extension)

Mints YouTube audio URLs in **your** browser so the VIBEX web player can play
YouTube Music tracks. Nothing is uploaded, proxied, or stored: the URL is minted
by a hidden tab on `music.youtube.com`, used by the player, and forgotten.

## Why an extension is required

This is not a shortcut around writing the code — a web page **cannot** do it, for
two independent reasons:

| Barrier | What happens |
| --- | --- |
| `youtubei/v1/player` | Answers **403** to any request carrying a foreign `Origin`, including the CORS preflight. A page can neither call it nor read the answer. |
| `googlevideo.com` | Sets `Access-Control-Allow-Origin` for YouTube's own origins only. A page can play a media URL in `<audio>`, but cannot read its bytes *or* its `Content-Range` — so it cannot run the validity gate that stops a preview from truncating 60 s in. |

An extension has what a page cannot: it can run at `document_start` in the page
world of `music.youtube.com` (real injection, no timing games), and its service
worker can fetch `googlevideo` under host permissions, so the gate works
unchanged.

This is the same mechanism as the Android app's WebView mint, in the place where
the credentials already are: the listener's own browser, on the listener's own
connection. There is still no server session, no relay, and no proxy.

## Install (unpacked, for now)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → pick this `extension/` folder.
3. Open the VIBEX web app. Pick **YT Music**; the banner should now read
   "YouTube Music audio is resolved on this device" rather than "browse-only".
4. Press play on a YouTube track. Expect a few seconds of
   "Resolving … on this device…".

Requires Chrome/Edge 111+ (for `world: "MAIN"` content scripts).

## What each file does

| File | World | Job |
| --- | --- | --- |
| `app/page-hook.js` | page (app origin) | Installs `window.__VIBEX_STREAM_MINTER`, the seam the app looks for. |
| `app/bridge.js` | isolated (app origin) | Relays that hook to the service worker over `chrome.runtime`. |
| `yt/harvest.js` | page (YouTube) | Shims `XHR`/`fetch`/`addSourceBuffer` at `document_start`; answers with `ytInitialPlayerResponse` formats or the captured URLs. |
| `yt/relay.js` | isolated (YouTube) | Moves that answer to the worker. |
| `background.js` | worker | Opens the hidden tab, polls the harvester, runs the two range probes, closes the tab. |

The app owns every decision: which format, whether the URL is real, whether to
retry. See `music-app/src/lib/ytStream.js` — that module is unit-tested, this
directory is not.

## Known limits

- **Tracks with no audio-only rendition are refused**, not played as video.
- **A bot challenge is terminal.** This inherits the browser's reputation; it
  does not defeat the check. If YouTube asks you to sign in, the app falls back
  to JioSaavn and says so.
- **The visualizer falls back to simulated mode** for minted audio: cross-origin
  media in an `<audio>` element taints the Web Audio graph. Playback and seeking
  are unaffected.
- **~2–5 s cold mint.** Cached for `min(expire − 5 min, 4 h)`; cleared when the
  network changes, because the signature is bound to your IP.
- **One re-mint per track**, ever. Looping mints is how an address gets flagged.
