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

`mobile-verify.mjs` runs 17 checks on each of five viewports — 320×658, 360×640,
393×851, 412×915 and 851×393 landscape — covering horizontal overflow, bar
geometry, 40 px touch targets, hover-only controls, all four tabs, drawer
open/close, search, playback and the full player. Last run: **85/85**.

### Accessibility

`ux-audit.mjs` checks the things a layout assertion cannot see: WCAG AA contrast
for every text node against its computed background (both themes), accessible
names on interactive elements, adjacent tap-target spacing, truncation in the
compact player bar, and 1.3x system text. Last run: **0 findings**.

Fixed in that pass:

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
