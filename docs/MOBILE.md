# VIBEX on Android

VIBEX ships as a [Capacitor](https://capacitorjs.com) app, and it is
**completely standalone** — no server, no hosting, no account. Install the APK
and it works.

That's possible because the JioSaavn API this project wraps has no Node
built-ins: every import is `hono`, `zod` or `node-forge`, and it was written to
run on Cloudflare Workers. A Hono app is just a `Request -> Response`
function, so the same controllers that used to run on a server are bundled into
the app and called in-process. `src/lib/embedded-api.js` mounts them.

```
Browser                          Android
-------                          -------
UI  ->  gateway  ->  API         UI  ->  embedded API  ->  JioSaavn
        (server.mjs)                     (in the bundle)
```

The web build is unchanged and still needs the gateway. The two share every
line of UI code, and the ~145 kB (gzipped) API chunk is lazy-loaded, so web
visitors never download it.

---

## Build the APK

Prerequisites: **JDK 21** and the **Android SDK** (platform 35, build-tools 35).
Android Studio bundles both; otherwise install the command-line tools and run
`sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"`.

```bash
cd music-app
npm ci
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk
```

Copy it to your phone and install (you'll need to allow "install from unknown
sources"). Nothing to configure on first launch.

> **Low-memory machines.** `android/gradle.properties` pins the Gradle daemon
> to a small heap and a single worker, because the default settings get
> OOM-killed in a 2 GB container. On a normal dev machine you can raise or
> delete those lines for a faster build.

### A signed release build

The debug APK is signed with Android's shared debug key — fine for your own
phone, but it can't be upgraded in place from a differently-signed build.

```bash
keytool -genkey -v -keystore vibex.keystore -alias vibex \
        -keyalg RSA -keysize 2048 -validity 10000
cd android && ./gradlew assembleRelease
```

…after adding a `signingConfigs` block to `android/app/build.gradle`. Keep the
keystore out of the repo.

---

## How the native build differs

| Concern | On Android |
| --- | --- |
| API calls | Embedded — `src/lib/embedded-api.js`, no network hop to a server |
| CORS | jiosaavn.com sends none, so those calls go through the native HTTP stack (`src/lib/http.js`) |
| Downloads | `src/lib/download.js` fetches, tags and saves on-device |
| Lockscreen controls | `useMediaSession` (also active on desktop browsers) |
| Hardware back | `useAndroidBack`: modal → lyrics → full player → pop view → minimise |

### Why fetch is patched by hostname

`src/lib/http.js` replaces `fetch` with a wrapper that routes **only**
`*.jiosaavn.com` through `CapacitorHttp` (native OkHttp — no same-origin
policy, and `User-Agent` is actually settable there). Everything else, notably
the multi-megabyte audio download, stays on the WebView's own stack, because
the CDN already sends `Access-Control-Allow-Origin: *` and there is no reason
to drag that much data across the JS bridge.

Capacitor can patch `fetch` globally via `plugins.CapacitorHttp.enabled`. Don't
turn that on: the *web* implementation of `CapacitorHttp.request()` is built on
`window.fetch`, so a global patch calls the plugin, which calls the patch, until
the renderer dies. The wrapper is gated on a genuine device for that reason.

### Downloads

Files are written to **Documents/VIBEX** with full metadata — title, artist,
album, year, cover art and synced LRCLIB lyrics — using the very same
`tagger.mjs` the server uses (it's plain `Uint8Array`, so one implementation
serves both, verified byte-identical).

`Directory.Documents` is app-scoped, so no storage permission is requested. If
you'd rather land files in the system Downloads folder, that needs MediaStore
access via a plugin.

### Debugging the native path on a desktop

Set `window.__VIBEX_NATIVE = true` before the app's scripts run and the
embedded API path activates in a normal browser. Upstream calls will still be
CORS-blocked — it proves routing, not end-to-end success.

### Known limitations

- **Background audio is not guaranteed.** Android may throttle a WebView's
  audio when backgrounded for a long time. The real fix is a foreground
  service via a plugin; not done here.
- **No offline library.** Playback streams; only explicit downloads persist.
- **The visualizer is a canvas** and costs battery — switch it off in Settings.

### Distribution

Google Play will almost certainly reject a JioSaavn client that offers
downloads, so sideloading is the realistic route — which also makes the debug
build a perfectly reasonable end state for personal use.

---

## Phone layout

The desktop UI is three fixed columns (sidebar · content · now-playing). That
does not survive a 360 px screen, so phones get a different layout rather than
a squeezed one.

### Breakpoints

| Width | Layout |
|---|---|
| > 1240 px | Full three-column desktop |
| ≤ 1240 px | `#nowplaying` hidden |
| 641–900 px | Tablet: sidebar collapses to a 78 px icon rail |
| ≤ 640 px | **Phone:** single column, drawer + bottom tab bar |
| ≤ 360 px | Tab labels drop, icons only |
| landscape, ≤ 480 px tall, coarse pointer | Phone layout with compacted chrome |

The tablet rail is scoped to `min-width: 641px` on purpose. It hides
`.logo-text`, `.nav-label`, `.side-extra` and the playlist list; letting those
rules cascade into the phone layer would mean undoing them with
`display: revert`, which is unreliable on older WebViews.

A landscape phone is *wide but short*, so width alone would hand it the desktop
layout. It is matched on `max-height` plus `pointer: coarse` so that small
desktop windows are not caught by the same rule.

### Navigation

* **Bottom tab bar** (`MobileNav.jsx`) — Home / Search / Library / Stats, within
  thumb reach. It reuses the `NAV` array exported from `Sidebar.jsx`, so the two
  navigations can never drift apart. Artist and detail views keep *Search* lit,
  matching the sidebar's existing behaviour.
* **Drawer** — the sidebar becomes an off-canvas panel (82 vw, max 300 px) behind
  a hamburger in the top bar. Playlists live only in the sidebar, so collapsing
  it without a drawer would have made them unreachable.
* **Back button** order is now: drawer → playlist modal → lyrics → full player →
  previous view → minimise.

### Touch fixes

* `.pl-btn`, `.radio-btn` and `.rm-btn` were `opacity: 0` until `.song-row:hover`.
  There is no hover on a touchscreen, so add-to-playlist, start-radio and remove
  were invisible and unreachable. They are now always shown under
  `@media (hover: none), (pointer: coarse)`.
* `#searchInput` is 16 px — anything smaller makes the browser zoom on focus.
* Player bar and tab bar are opaque; the blurred translucent versions let
  scrolling content show through and made the labels unreadable.
* `viewport-fit=cover` plus `env(safe-area-inset-*)` for notches and the Android
  gesture bar.

### Compact player bar

At ≤ 640 px the player bar drops to 62 px and keeps only thumb, title, prev,
play and next. Shuffle, repeat, volume, quality, like and download all still
exist one tap away in the full player, which is what the bar opens on tap.

### Verification

```bash
cd music-app
npm run build && PORT=8000 node server.mjs   # terminal 1
npm run verify:mobile                        # terminal 2 — add --headed to watch
```

`mobile-verify.mjs` drives a real Chromium over the built bundle. It runs 17
checks on each of five viewports — 320×658, 360×640, 393×851, 412×915 and
851×393 landscape — covering boot, unhandled page errors, horizontal overflow
(naming the worst offending element), phone-vs-desktop layout, tab bar and
player bar geometry, safe-area insets, 40 px touch targets, the 16 px search
input, all four tabs, drawer open/close, hover-gated row actions and the full
player. It prints a per-viewport scorecard and exits non-zero on any failure.

Every `/api` request is answered from `test/fixtures/api.js`, so a run does not
depend on the live JioSaavn catalogue, on the API process, or on network egress —
and the same run means the same thing every time.

Requirements: `npm i -D playwright && npx playwright install chromium`, plus a
running gateway. If either is missing the script exits `2` and says so; it never
reports a pass it did not earn. It also runs on every push in CI.

### Accessibility

```bash
npm run verify:ux      # same prerequisites as verify:mobile
```

`ux-audit.mjs` checks the things a layout assertion cannot see, on a 393×851
phone viewport:

* **WCAG 2.1 AA contrast** for every visible text node, against the first opaque
  background behind it, in **both themes** — 4.5:1 for body text, 3:1 for text
  ≥ 24 px or ≥ 18.66 px bold. Alpha is composited over that background rather
  than ignored.
* **Accessible names** on every interactive element. A `title` attribute alone
  counts as *unnamed*: TalkBack does not reliably announce it and touch users
  never see it.
* **Adjacent tap-target spacing** — flags controls closer than 8 px in the same
  row or column.
* **Clipping** in the compact player bar and tab bar.
* **1.3× system text** (Android's largest non-display font scale) for horizontal
  overflow and player-bar truncation.

It exits `0` only with zero findings, exits `2` if it could not actually run, and
runs on every push in CI.

The findings below are what an earlier manual pass fixed; the script exists so
they stay fixed:

* Light theme `--muted` was 4.16:1 on the page and 3.30:1 on cards — below AA.
  One token governed eight reported elements.
* `body.light .mode-badge` (specificity 0,0,2,1) outranked `.mode-badge.live`
  (0,0,2,0), so the light theme painted dark-gold text onto the dark-green
  badge at **1.9:1**. The variants now have explicit light-theme rules.
* `--accent` as *text* is only 2.89:1 on a light background. Split into
  `--accent-text` so the fill colour and the text colour can differ per theme.
* Light `--accent` with white ink was 3.30:1; darkened one shade to `#15803d`
  (5.02:1).
* The theme and settings buttons are emoji-only and carried just a `title`,
  which TalkBack does not reliably announce and touch users never see. They now
  have `aria-label`s.
* Transport buttons sat 4px apart; widened to 8px to reduce mis-taps.

Not covered by the script, and still worth a pass on real hardware: TalkBack
reading order, true notch/cutout insets, Android's own font-scale setting, and
the hardware back button (a Capacitor plugin event that cannot be raised from a
browser). The drawer also opens only from the hamburger — there is no
edge-swipe gesture, which Android users may expect.


---

# VIBEX on iPhone (home-screen web app)

VIBEX does not need an App Store build on iOS. The same deployment that runs at
<https://vibex-music-pi.vercel.app> installs to the Home Screen as a full-screen
web app, with its own icon, launch screen, lock-screen controls and background
audio.

## Install

1. Open the site in **Safari** (not Chrome, Firefox or an in-app browser —
   only Safari can add a real home-screen web app on iOS).
2. Tap **Share** → **Add to Home Screen**.
3. Leave **Open as Web App** switched on (iOS 26 defaults to it) and tap **Add**.

Inside the app, **Settings → Install VIBEX** shows the same steps. On Android
and desktop Chrome the sheet offers a real **Install app** button instead.

## What works once installed

| Surface | Behaviour |
| --- | --- |
| Home screen | VIBEX icon (180 px Apple touch icon, 512 px manifest icons) and a name under it |
| Launch | Near-black iOS launch screen with the VIBEX mark — no white flash |
| Window | Full screen, no Safari bars; `viewport-fit=cover` layout with safe-area insets |
| Status bar / Dynamic Island | Opaque dark strip with white glyphs (see below) |
| Lock screen, Control Center | Track, artist, album, artwork, play/pause, next/previous, scrubbing |
| Dynamic Island | The system **Now Playing** presentation (artwork + waveform) while audio plays |
| Background audio | Continues with the screen locked and while using other apps |
| Offline | The shell opens from cache; liked songs, playlists and stats are local |

### About the Dynamic Island

Apple only allows **native** apps to draw custom content into the Dynamic Island
(Live Activities and, from iOS 26, the Now Playing framework). A website — even
an installed one — cannot add its own island UI. What a web app *can* do, and
what VIBEX does, is two things:

1. **Lay out around it.** `viewport-fit=cover` plus `env(safe-area-inset-*)`
   keeps the top bar, sheets and player clear of the island/notch, in portrait
   and in landscape (where the notch is on the side).
2. **Drive the system media session.** `useMediaSession` publishes title,
   artist, album, artwork and transport actions through the Media Session API,
   which is what iOS surfaces on the Lock Screen, in Control Center, and in the
   Dynamic Island's Now Playing view while audio plays.

A true Live Activity — a persistent island widget with VIBEX-drawn content —
would require an Xcode target with a WidgetKit extension and an Apple Developer
account. That cannot be deployed through Vercel.

### Why the status bar is `black`, not `black-translucent`

`black-translucent` is the only value that lets the page render *under* the
status bar. It also forces **white** glyphs, which are unreadable in the light
theme, and on recent iOS releases it adds a frosted blur over the top edge.
VIBEX therefore uses `black`: a stable dark strip that matches the app in both
themes, with the document starting below it, so no control can hide behind the
Dynamic Island. The `theme-color` meta is kept in step with the in-app theme for
Android Chrome and for iOS 26's background sampling.

### Why the live spectrum is off on iPhone

Attaching a Web Audio `MediaElementSource` moves `<audio>` onto WebKit's Web
Audio path. In an installed web app that path is suspended when the screen
locks, and the music pauses with it — the most common way a web music player
breaks on iOS. On iPhone VIBEX therefore skips the analyser (`liveOK` starts
`false`) and draws the simulated bars/waves/orbit visualiser instead. Playback
stays a plain media element, which is exactly what iOS keeps alive in the
background. Other platforms keep the real spectrum.

A second iOS quirk: when a stream stops naturally, or the app sits paused for a
while, iOS can tear down the audio session and `play()` then rejects. The
Lock Screen play button calls a recovery path that re-opens the stream at the
same playhead, and returning to the app re-asserts
`navigator.audioSession.type = 'playback'` and resumes only when the user's
intent was still "playing".

### Offline behaviour

`public/sw.js` caches the app shell only:

* Navigation is **network-first** with a 4.5 s timeout, falling back to the
  cached `index.html`. A new deploy is picked up on the next launch.
* `/assets/*` (Vite's content-hashed files) are cache-first.
* `/api/*`, `/dl` and any range request are **never** intercepted: cached
  catalogue responses would be stale, and proxying audio would break seeking.

Starting in **Library** or **Stats** while offline works from localStorage; the
feed and search show a retry screen with an "Open your library" shortcut.

### Debugging on a device

1. On the iPhone: **Settings → Safari → Advanced → Web Inspector**.
2. Connect it to a Mac and open **Safari → Develop → [iPhone] → VIBEX**.
3. In the console, verify the install state:

```js
document.documentElement.dataset.platform   // "ios-standalone"
navigator.standalone                        // true
matchMedia('(display-mode: standalone)').matches
navigator.mediaSession.metadata             // title/artist/artwork
navigator.audioSession?.type                // "playback" while a track is live
```

Remember that iOS freezes the manifest, icons and launch screens **at install
time**: after changing them, delete the home-screen app and add it again.
