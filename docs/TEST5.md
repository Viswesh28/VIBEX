# Vibex 2.0-test5 — missing notification player fix

Personal Android testing update, 7 October 2026.

## Report and confirmed defect

You reported that music continues after leaving Vibex, but the music player is **not visible in the notification shade**.

The earlier check confirmed that a MediaSession existed, but missed how it was registered. Vibex starts `VibeAudioService` directly from its Capacitor bridge; it does not first bind a UI `MediaController` to the service. Creating a MediaSession and implementing `onGetSession()` are insufficient on that direct-start path: the service's notification manager had no registered session to observe.

A new Robolectric test instantiated the actual service without connecting an external controller. **Before the fix it failed: expected one registered session, found zero.**

## Fix

Immediately after constructing the session, the service now calls:

```java
addSession(session);
```

This attaches Media3's notification controller and foreground-service management before queue restoration/playback. Media3 can then publish the music card, metadata, playback state, and controls independently of the WebView.

- Uses the existing native player and standard Android media notification—not a floating overlay or browser notification.
- Keeps the real player's position/duration as the source for system media controls.
- Keeps the existing notification tap → current-song behavior.
- Does not add progress polling, a custom timer, or a duplicate notification.
- Empty startup does not display a fake music notification.
- All prior features remain: fixed top header, direct return to player, library, downloads, lyrics, playlists, manual Battery Saver, and existing playback preferences.

Implementation was checked against the exact Media3 **1.5.1** dependency's [MediaSessionService source](https://github.com/androidx/media/blob/1.5.1/libraries/session/src/main/java/androidx/media3/session/MediaSessionService.java) and [MediaNotificationManager source](https://github.com/androidx/media/blob/1.5.1/libraries/session/src/main/java/androidx/media3/session/MediaNotificationManager.java). This is a focused integration correction, not a framework rewrite.

## Verification

- **44 JavaScript logic tests passed.**
- **26 browser integration tests passed.** These retain the fixed-header and app-return regressions; they do not test Android's notification shade.
- **32 JVM tests passed:** the earlier 30 tests plus two new Android-framework simulations using Robolectric, on API 28 and API 33 configurations.
- Both notification simulations instantiate the real `VibeAudioService` and use real Media3 session/notification code. A deterministic test player replaces audio decoding for the notification-control checks.
- Assertions verify: session registration without an external connection; no notification for an empty idle session; foreground notification publication when playing; current title; platform media-session token; notification activity intent; duration and seek capability; advancing position without a WebView; pause holding position; seeking to 30 seconds; resume; next-track metadata; and no duplicate session.
- The external test controller is connected **only after** the notification has been published, so it cannot hide the original registration defect.
- Android assembly/lint passed: **0 errors, 33 warnings**. Assembly/lint took 2m 3s; final JVM test run took 33s. Test JVMs run separately with bounded memory for this small build workspace.
- Final APK passes signature and ZIP-alignment verification. Packaged web files match the tested build byte-for-byte.
- APK disassembly confirms the `addSession` call is present in `VibeAudioService`. Robolectric/test classes are not packaged into the APK.

**Limit:** these are framework simulations, not a physical phone or rendered Android System UI. No real-device notification screenshot or live phone check is claimed. Your phone model and Android version have not been supplied, so OEM-specific display behavior remains unverified.

## Install and check

1. Install **Vibex-2.0-test5.apk over test4**. Do not uninstall first.
2. Open Vibex and play a song. Allow notifications if Android asks.
3. Press Home, pull down the notification shade, and fully expand the music card.
4. Check the song title and play/pause controls. Where your Android version provides a seek slider, confirm that it advances, pauses correctly, and seeks the song when dragged.
5. Skip to another song and check that the title updates. Tap the card to return to the player.

The layout and availability of the system seek slider depend on Android version and the phone manufacturer; Vibex supplies the media session, seek capability, duration, and playback state rather than drawing that system slider itself.

If the card is still absent, report the phone model, Android version, whether Settings → About shows **2.0-test5**, and ideally a short recording. Also check Android's notification/media-control settings for Vibex. Do not uninstall as a troubleshooting step unless your library is backed up.

## APK identity

| Field | Value |
|---|---|
| App name | **Vibex** |
| Package | `dev.viswesh.vibex.testing` |
| Version | `2.0-test5`, code **7** |
| Android | Minimum API 23; target API 35 |
| Signing | Same development certificate as test4 |
| Icon | All 29 launcher resources match test4 byte-for-byte |
| Size | 7,946,282 bytes |
| Library | Existing schema and data retained; no new migration |

SHA-256: `0c4f49c5072c476a3f0f344e4dcf51262e5185b431d4dc07ed48d22cc22795c2`.

Creator credit remains **Made with ❤️ by VISWESHSARAVAN**. This is a debug-signed personal-test build, not a production release. Existing dependency advisories and device-validation caveats still apply; runtime dependency versions were not upgraded. Robolectric is a test-only dependency.

## Files

- `Vibex-2.0-test5.apk`
- `Vibex-2.0-test5.sha256`
- `Vibex-test5-notes.md`
- `Vibex-test5-changes.patch` — **incremental changes on top of the test4 working source**, unlike the earlier full patches against the original repository HEAD.

No commits, pushes, publication, GitHub credentials, or signing-key changes were involved in this update. Android Force stop and OS process termination remain able to stop playback.
