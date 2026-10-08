# Vibex 2.0-test4 — background playback, direct return, fixed header

> Superseded by [Vibex 2.0-test5](TEST5.md). Test4 had a missing direct-start media-session registration that could leave the notification card absent while audio played. Test5 corrects that defect; the test4 results below did not include notification publication testing.

Built 7 October 2026. Personal Android testing update.

## Your requested behavior

You selected both continuous playback outside Vibex and returning directly to the current song, plus freezing the top app header (not the page filters).

### 1. Keep the music playing outside Vibex

Vibex already has a native Media3 `MediaSessionService`; the player is not owned by the WebView. This update preserves that separation and makes the task-removal policy explicit and tested:

- Pressing Home, switching apps, locking the screen, or minimizing with Back at the navigation root does not issue a pause command.
- Active/requested playback and buffering can continue after the UI task is removed, provided **Stop when dismissed is off** (the existing default).
- A temporary audio-focus interruption preserves the intent to resume, rather than treating it as an ordinary user pause during task removal.
- Explicit user pause, sleep timers, headphone-disconnect handling, and audio-focus rules are still respected.
- Empty, ended, or deliberately paused sessions do not keep an idle service running just because the UI was dismissed.

**Important:** Settings → Playback → **Stop when dismissed** remains an intentional opt-out for swiping the app out of Recents. Turn it off for continued playback in that case. It does not control ordinary Home/screen-lock behavior.

### 2. Return directly to the current song

- Reopening the app or returning after a genuine background transition opens **Now playing** when a current track exists.
- Notification-body and widget-title taps explicitly request the player screen, including when Vibex is already open.
- The UI waits for an authoritative player snapshot. It does not rebuild the queue, seek to zero, or issue a new play command merely because you returned.
- A paused song remains paused. A cold reopen with a saved queue shows the restored song without unexpectedly starting audio.
- Each launch/return request is handled once. Closing the player does not immediately reopen it, and ordinary track changes do not repeatedly force it onscreen.
- An empty session stays on the normal app screen.
- File-picker round trips and unfinished playlist/options dialogs are protected from unwanted navigation. In-progress dialog input is not discarded just to show the player.
- The native Back-button subscription is stable across play/pause changes; at the app's navigation root it minimizes rather than force-exits.

The Android activity tracks true stop/resume boundaries separately from external activity-for-result flows. The JavaScript routing gate only changes the displayed screen; it never controls audio transport.

### 3. Freeze the top header

The Vibex/back/Settings app bar now stays at the top while the middle content scrolls. Existing bottom navigation and mini-player behavior are retained.

- Applies to Home, Search, Library, Downloads, Settings, and other main-page content.
- Page-specific filters/search controls still scroll, as requested.
- Opaque header background prevents content showing through it.
- Scroll padding keeps focused controls clear of the header.
- Works on mobile and desktop layouts; player/dialog overlays remain above the header.
- Implemented with CSS sticky positioning—no scroll timer or animation loop was added.

## Installation and compatibility

Install **`Vibex-2.0-test4.apk` over test3. Do not uninstall first.** An exported library backup is a sensible additional precaution.

| Field | Verified value |
|---|---|
| App name | **Vibex** |
| Package | `dev.viswesh.vibex.testing` |
| Version name | `2.0-test4` |
| Version code | **6** |
| Minimum Android | API 23 / Android 6.0 |
| Target Android | API 35 |
| Signing | Same development certificate as the delivered test3 APK |
| Launcher artwork | All 29 launcher resources match test3 byte-for-byte |
| Library schema | Still version 2; no destructive migration |
| APK size | 7,946,265 bytes |

SHA-256: `db672bcc38d8744e89792c1704aec9029e1ad11dc446dc5e5c579d8f1b56bd65`.

The selected icon, app name, creator credit **Made with ❤️ by VISWESHSARAVAN**, and all test3 features remain. Manual Battery Saver, persistent Home picks, playlist pins/sorting, lyric offsets, and optional autoplay are not removed or reset. No new runtime permission or periodic background job was introduced.

## Verification

- **44/44 JavaScript logic tests passed.** Includes once-only foreground routing, initial hydration, empty sessions, hidden-state deferral, paused returns, picker suppression, and dialog preservation.
- **26/26 browser integration tests passed.** Includes fixed mobile/desktop headers, unchanged bottom navigation, actual HTML-audio playback through a *simulated* visibility round trip, no repeated stream resolution on return, paused position preservation, cold reopen, empty-session behavior, and preservation of an unfinished playlist draft.
- **30/30 Android/JVM unit tests passed.** Includes six activity-return policy tests and four background/task-removal policy tests, in addition to the earlier power, retry, radio-parser, and listening tests.
- Android assembly, unit task, and lint passed: **0 lint errors, 33 warnings**. Final combined Gradle run completed in **49 seconds**.
- Signature, ZIP alignment, package name, app label, version, and unchanged launcher resources verified directly against APKs.
- Final packaged web files match the tested `dist` files byte-for-byte.
- Live-catalog mobile smoke had no page errors. After scrolling the middle **700 px**, the header remained at **y = 0**, while bottom navigation stayed visible.
- The Home-refresh test now waits for the expected network requests rather than relying on the button's brief pre-effect enabled state; its request-count assertion is unchanged.

These are browser and JVM tests, **not instrumented Android device tests**. No physical-phone screen-off, Bluetooth, notification-intent, or OEM battery-management acceptance test was performed here.

## Quick phone test

1. Update over test3 and confirm your library/downloads/settings remain.
2. Play a song, press Home, and lock the screen for several minutes. Confirm audio and lock-screen controls continue.
3. Reopen Vibex. The current song should appear immediately, at its live position—not restarted.
4. Pause, leave, and return. The player should open but stay paused.
5. Tap the media notification and the widget title; both should open the current song.
6. With **Stop when dismissed off**, swipe Vibex from Recents while playing. Check continued playback and reopen it.
7. Open a file picker or start a playlist draft, leave/return, and verify the flow is not hijacked.
8. Scroll Home and Settings. Logo/back/Settings should remain at the top, Library and other navigation at the bottom.

If background audio still stops, report the phone model, Android version, exact action (Home, screen lock, Recents swipe, or Force stop), whether the notification remains, and the **Stop when dismissed** setting. That distinguishes an app lifecycle problem from a device restriction.

## Limits and release caveats

- Android **Force stop**, explicit system media-service stopping, device shutdown, and OS/OEM process termination can stop music. This update does not attempt to defeat those controls or silently start music after a reboot.
- Browser previews cannot guarantee playback after a browser tab/process is closed; Android native playback is the target of this feature.
- No new battery-life percentage claim is made. Test3's background UI-polling reductions and Saver behavior remain in place.
- This is still debug-signed personal-test software. The existing production dependency advisory for `node-forge` (GHSA-86w9-cpqp-85rv, previously reported with no offered fix) remains a release-readiness caveat; no runtime dependency upgrade was part of this update.
- Local audio files/permissions are not carried by portable JSON backups. Existing backup and process-kill checkpoint limitations remain; see [test3 notes](TEST3.md).

## Deliverables

- `Vibex-2.0-test4.apk`
- `Vibex-2.0-test4.sha256`
- `Vibex-test4-notes.md`
- `Vibex-test4-changes.patch` — full local source changes against the repository's original checked-out HEAD, including earlier work; not an incremental patch to layer over the previous full patch.
- [Fixed-header screenshot](screenshots/test4/fixed-header.png) · [Background settings](screenshots/test4/background-settings.png)

No commits, pushes, store publication, or signing-key changes were performed.
