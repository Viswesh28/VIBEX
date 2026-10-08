# Vibex 2.0-test3 — battery-aware update

> Superseded by [Vibex 2.0-test4](TEST4.md). This document describes the historical test3 build.

Built 7 October 2026. Personal Android testing build, not a production release.

## Install as an update

Install **`Vibex-2.0-test3.apk` over test2**. **Do not uninstall first.** Export a library backup before updating if you want an additional safeguard.

- Display name remains **Vibex**.
- Same package: `dev.viswesh.vibex.testing`.
- Same signing certificate as the delivered test2 APK, verified directly against both artifacts.
- Version code **5**, version name **2.0-test3**.
- Android 6.0/API 23 minimum; target API 35.
- The selected AI-generated launcher icon is unchanged. All 29 launcher resources in the APK match test2 byte-for-byte.
- The Settings credit remains **Made with ❤️ by VISWESHSARAVAN**. The removed top-right avatar has not returned.
- Library schema stays at version 2. New fields have backward-compatible defaults; there is no destructive database upgrade.
- This updates the existing *testing* app, not the separate original `dev.viswesh.vibex` production package.

APK SHA-256: `481c0b144f4d37c77f18fea72d98e8e4eabc2f12b1541057eac6d436b68818f3`.

If Android reports a signature conflict, send the exact message rather than uninstalling and losing data.

## 1. Always-on efficiency improvements

These improvements apply **even when Battery Saver is off**.

### Native playback service

- **No recurring maintenance tick while idle/paused/buffering.** State changes restart the maintenance loop when playback actually resumes. A user-set sleep timer has its own one-shot callback.
- During ordinary playback with listening statistics enabled, maintenance/accounting ticks move from **500 ms to 2 seconds** outside crossfade windows. Shorter ticks are confined to approaching/active transitions.
- Periodic resume checkpoints move from **5 seconds to 15 seconds** in normal mode. Pause and queue changes still save promptly; duplicate snapshots are not written again.
- **Widget updates are event-driven**, based on current track and playing state, rather than a repeating five-second refresh.
- Restoring a paused queue **does not prepare a network stream**. Duration can be displayed from stored metadata until the user resumes.
- Flat EQ does not allocate an audio-effect object. Unrelated settings changes no longer tear down and recreate the same EQ configuration.
- Local files and completed downloads use the local playback wake mode rather than unnecessarily holding the streaming Wi-Fi lock. Media3 still manages the locks required for reliable playback.
- Playback retries are bounded: a transient READY state alone no longer resets the failure budget. Sustained playback is required, stale retry callbacks are fenced, and failed stream resolutions invalidate the short-lived URL cache.

### UI, bridge, storage, and artwork

- Position updates are isolated from the main app context. Home, search, library, and settings no longer re-render on every progress update.
- Native progress uses lightweight queue-versioned snapshots; unchanged queues are not repeatedly rebuilt and transferred over the bridge.
- Structural player/download changes arrive through native events. Visible progress polls stop when paused and all UI pollers stop while the document is hidden.
- Listening-history checks use a revision token and a 30-second visible cadence, instead of repeatedly transferring an unchanged event history every four seconds.
- Download progress keeps a faster cadence while active; idle checks are slower, with native status events for prompt changes.
- Ordinary library/preference edits no longer re-index every song into the native metadata table. Metadata is indexed on queueing, downloading, local import, and explicit backup restoration.
- Native artwork caching waits until covers are near the viewport, avoids starting this work while hidden, and avoids initially loading both the remote and cached versions of a cover in the WebView.
- Browser-only playback also uses an active-only timer and bypasses the Web Audio graph until a non-flat EQ is needed. Android continues to use Media3, not browser audio.

**These are reductions in scheduled work and unnecessary processing—not measured percentage reductions in phone battery drain.** Normal decoding, Android/media-session activity, downloads, network use, and enabled effects still consume power.

## 2. Manual Battery Saver

Find it at **Settings → Battery & efficiency → Battery Saver**. It is **off by default**, persists across restarts, and has a leaf indicator in the top bar when enabled.

| Behavior | Normal mode | Battery Saver |
|---|---|---|
| Recurring native idle maintenance | None | None |
| Playback progress polling while visible/playing | 1 second | 2 seconds |
| UI polling while hidden | Stopped | Stopped |
| Scheduled resume checkpoint during playback | 15 seconds | 30 seconds |
| Crossfade second deck | Uses your saved preference | Suspended |
| Automatic radio refill | Optional | Suspended |
| Previously saved Home metadata | Refreshed on a visit after 15 minutes | Reused until manual refresh, subject to 7-day retention |
| UI animations/transitions | Normal/reduced-motion preference | Disabled |
| Streaming quality and EQ choice | Your selection | Unchanged |
| User-started downloads | Your controls/network preference | Unchanged |

Turning Saver off restores the effect of your existing crossfade/autoplay preferences; it does not erase them. Existing queue items still play. Normal buffering needed to play music is not disabled.

This is the manual mode selected for test3. It does **not** automatically follow Android's system Battery Saver setting and does not request a battery-optimization exemption.

## 3. Selected feature bundle

### Persistent Home picks

Home songs and album metadata survive app restarts and can be browsed offline after an initial successful fetch.

- Separate, disposable cache: up to **12 responses**, approximately **2 MB**, maximum age **7 days**.
- Normal freshness window: **15 minutes**, checked when Home is visited—not by a background refresh timer.
- “Refresh Home” explicitly bypasses freshness, including in Saver.
- Saved/offline status is shown on Home. Failed refreshes retain usable cached content.
- Settings has **Clear saved Home picks**. This does not delete likes, playlists, audio, or downloads.
- Audio URLs are removed from persisted Home data. Playing an online track still resolves a fresh stream.
- Metadata caching is **not an audio download**. Use managed downloads for offline listening.
- The cache is excluded from portable library backups.

### Playlist pinning and sorting

Open a playlist and choose **Pin playlist**. On the library overview, sort by recently created, name, or track count. Pinned playlists remain first. Pins and the sort preference survive restarts; playlist pin data is preserved in backups.

### Per-song lyric timing

Open **Player → Lyrics → This song’s timing**. The override is stored for that recording, from −30 to +30 seconds in quarter-second steps. Positive offsets display lyrics earlier.

**Use global timing** removes the override and follows the Settings value again. An explicit zero is a real override, not “missing.” Overrides for portable online songs are included in backups; local-file entries remain device-specific as before.

### Optional autoplay queue

Enable **Settings → Battery & efficiency → Autoplay queue**. It is **off by default**.

- Searches the current artist through the app's existing JioSaavn catalog near the end of the queue.
- Adds at most **six distinct track IDs per successful lookup**, excluding IDs already queued.
- One lookup at a time, at least 30 seconds between attempts, a 200-track queue cap, and a stop after two consecutive empty/failed lookups until a new queue is started.
- Suppressed during Saver, shuffle, repeat, a sleep timer, local-file playback, or paused playback.
- Native Android resolution runs in the playback service, without requiring the WebView to stay awake. Screen-off behavior still needs device acceptance testing.
- Cancellation/state checks prevent a late response from replacing a manually changed or paused queue.
- Does not create offline downloads. Connectivity and provider availability are required.
- Artist-search results can include alternate versions/languages. This is not an AI recommender or exact-recording replacement feature.

## 4. Reference projects and licensing

This release independently implements general ideas identified in the earlier SimpMusic, Echo Music, and BloomeeTunes reviews: library organization, adjustable lyrics, persistent metadata caching, and bounded continuous listening.

No implementation code or branding was copied from those GPL projects. Vibex retains its React/Capacitor/Media3 architecture, existing catalog, selected icon, and existing repository license. No provider-plugin runtime or additional music service was introduced.

## 5. Verification completed

- **36/36 JavaScript logic tests passed**: existing rules plus cache persistence/expiry/bounds/clearing, metadata sanitization, migration defaults, pins, per-track offsets, autoplay eligibility, and idle poll scheduling.
- **19/19 browser integration tests passed** using controlled catalog/audio fixtures: existing behavior plus Saver persistence, Home restart/offline/refresh/clear, playlist pins/sorting, per-song offsets, progress isolation, six-track autoplay refill, and stale-response cancellation.
- A browser integration assertion observes **zero Home-content DOM mutations while playback progress advances** after initial track/catalog changes settle. This does not claim zero CPU use or constitute a phone performance benchmark.
- **20/20 Android/JVM unit tests passed**: five existing listening-ledger tests, six power-policy tests, four retry-budget tests, four radio-parser tests, and the existing template test.
- Final Gradle assembly, unit tests, and lint passed. **0 lint errors, 33 warnings**. Final combined Gradle run: **44 seconds**.
- Live public-catalog smoke of the native Java radio resolver returned six candidates for an artist query. This tested metadata resolution, not on-device playback.
- Live-catalog browser smoke: no page errors or horizontal overflow at 393 px; Home and Battery Saver UI screenshots reviewed.
- APK signature and ZIP alignment verified. Package/name/version checked. Final web files match the packaged APK bytes, with test3 features and creator credit present.

The native unit tests are not instrumented Android service/device tests. No physical-phone install, battery profiling, Bluetooth test, or OEM background-playback test was performed here.

## 6. Phone acceptance checklist

1. **Update/data retention:** install over test2; check likes, playlists, recent searches, downloads, local-file access, and resume position.
2. **Normal mode first:** leave Saver off and play for 30–60 minutes with the screen off. Check notification controls, headphone disconnect, calls/audio focus, and Bluetooth next/pause/resume.
3. **Saver switching:** switch it on during playback, including near a transition. Music should continue; crossfade/autoplay should pause without losing their settings. Switch it off and check that those preferences resume applying.
4. **Offline:** load Home once, then turn off connectivity. Saved picks should be visible; only downloaded/local tracks are guaranteed to play offline.
5. **Autoplay:** enable it, play near the end of a short online queue, and test screen-off continuation. Pause or change queues while a lookup is pending. Existing songs must not be unexpectedly replaced.
6. **Lyrics/library:** pin a playlist, change sorting, set two different lyric offsets, restart, and verify they remain distinct.
7. **Compare power fairly:** use the same tracks, duration, output volume/device, connectivity, screen state, and starting conditions. Compare test3 normal vs Saver using Android's battery-usage tools. Charging, weak mobile signal, screen brightness, EQ/crossfade, and other apps can dominate results.

Do not interpret normal-versus-Saver estimates as a guaranteed battery percentage. If you report unusual drain, include phone model, Android version, session duration, screen-on time, network/output used, relevant settings, and a battery-usage screenshot.

## 7. Remaining caveats

- This is development/debug-signed personal-test software, not a security-cleared production release.
- The production dependency audit still reports the existing **node-forge high-severity advisory GHSA-86w9-cpqp-85rv**, with no fix offered by the audit output. No forced dependency upgrades were performed.
- Upstream catalog/lyrics availability and exact lyric matching remain external constraints.
- Resume checkpoints are intentionally less frequent. Abrupt process termination can lose the last roughly 15 seconds of position in normal mode or 30 seconds in Saver; ordinary pause/queue actions save promptly.
- Ordinary Android/media-engine work is not eliminated. No claim of zero battery drain, universal power limits, or perfect optimization is made.
- Existing local-file permissions and actual audio are not carried by portable JSON backups. Browser local-file URLs remain session-bound.

## Source and artifacts

- APK: `Vibex-2.0-test3.apk`.
- Checksum: `Vibex-2.0-test3.sha256`.
- Standalone notes: `Vibex-test3-notes.md`.
- Full local source patch against the repository's original checked-out HEAD: `Vibex-test3-changes.patch` (includes earlier v2/test1/test2 work; not a patch to apply on top of the previous full patch).
- Screenshots: [Home](screenshots/test3/home.png) · [Battery Saver](screenshots/test3/battery-saver.png).

No commits, pushes, store publication, or signing-key changes were made.
