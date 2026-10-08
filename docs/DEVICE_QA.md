# Android device acceptance checklist

**Status: not executed on a device/emulator in this implementation session.** Passing builds, unit tests, lint and browser tests are not evidence that these checks passed.

Test at least API 23, a recent API 33+ device, and API 35/36 where available. Include one OEM with aggressive battery management. Use the debug build first; use the actual release signing key for upgrade testing on an existing installation. Never uninstall a user's only copy of the old app to bypass a signing mismatch: export a backup first.

## Upgrade/data safety

- [ ] Seed old VIBEX with likes, two playlists, order changes, theme, data-saver/crossfade preferences and cumulative stats. Upgrade without clearing storage. Confirm migration preserves them and old localStorage is still present.
- [ ] Force-close during a library write; reopen without a blank/reset library. Verify meaningful storage-full errors with a nearly full test device.
- [ ] Export JSON through the system picker, cancel export, import invalid/oversized JSON, then import a valid backup in merge and replace modes. Confirm playlist order, preferences, imported LRC words, legacy totals and events.
- [ ] Replace does not delete managed audio files or existing local-song records. Restoring on another device requires re-importing local documents; the backup must not claim to contain audio.

## Native player/session

- [ ] Play for 20–30 minutes with screen locked and UI backgrounded. Check notification title, artist, artwork, position, pause/resume and previous/next.
- [ ] Verify Bluetooth/headset/lock-screen commands target the same native queue as the UI. Never hear two authoritative players.
- [ ] Receive/end a call; start another media app; trigger a navigation prompt while crossfading. Verify pause/resume intent and ducking, with no sudden full-volume burst.
- [ ] Unplug wired headphones and disconnect Bluetooth. Confirm there is no surprise speaker playback or unwanted resume.
- [ ] Test both Recents-dismiss preferences. Force-stop is explicitly not a supported background-play guarantee.
- [ ] Deny notification permission, then grant it. Test API 35+ foreground-service/audio-focus restrictions and process recreation.

## Queue/crossfade/sleep

- [ ] Exercise an empty queue, one track, the final track, shuffle, repeat-one and repeat-all, including natural track endings.
- [ ] Select/remove/reorder the current and upcoming tracks during buffering and crossfade; use both app and system controls. No wrong-track promotion or double audio.
- [ ] Crossfade at 0/3/12 seconds with network stalls, short files, local files and mixed queues. Observe notification/lyrics position around deck promotion.
- [ ] Restore an interrupted session paused at approximately the saved position, preserving queue/order/settings. Playback must not begin unexpectedly.
- [ ] Sleep timer pauses while locked; manually pausing during a temporary focus loss must not be undone later.

## Offline/downloads

- [ ] Queue several tracks; pause/resume/retry/cancel/remove. Partial/failed downloads must never appear ready.
- [ ] Complete a download, close the UI, disable all networking, restart the app and play it. Observe that URL resolution is not required for the completed copy.
- [ ] Switch Wi-Fi/metered/unmetered connections, deny permission, restart process, test disk full and server errors.
- [ ] Stream at 320 kbps while partially downloading at 160 kbps; switch settings and retry. Never mix bytes from different qualities. Remove before replacing an offline copy's bitrate.
- [ ] Clear temporary cache without deleting managed downloads. Restart after changing the cache limit and confirm storage accounting.
- [ ] Open lyrics online, then play that downloaded track offline. Cached lyrics/artwork should remain available when present; no universal coverage is promised.
- [ ] Verify explicit tagged export remains distinct from app-managed download storage.

## Local audio/EQ/widget

- [ ] Import MP3/M4A/FLAC where supported, including no-tag files, embedded artwork, multiple files, permission denial and malformed media. Count/report unreadable files accurately.
- [ ] Restart after import; persist access. Move a document or revoke its grant and confirm a useful error and successful re-selection.
- [ ] Check EQ presets/Flat on speaker, wired and Bluetooth outputs, including crossfade. Unsupported EQ devices must still play normally.
- [ ] Add/resize multiple widgets. Check transport while app is open/backgrounded, service is absent, and after process restart. Cold-widget behavior currently opens the app.

## Accounting/privacy/accessibility

- [ ] Compare measured listening against a stopwatch through pause, seek, buffering and interruptions. A play marker requires five credited seconds; overlap is not doubled. Short skips have zero listening seconds.
- [ ] Disable collection, clear history, restart, and inspect the exported JSON. Old raw history should not reappear after clear.
- [ ] Test TalkBack focus/order/labels, large Android text and display scale, narrow phones, landscape, keyboard Tab/Escape, reduced motion, safe areas and nested sheets.
- [ ] Test a large library/playlist for responsiveness, memory and battery use. Native polling and queue serialization need measurement on actual hardware.

Record device, Android version, app build, scenario, result, logcat excerpt and reproducible steps for each failure. Do not convert this checklist to “passed” based only on the browser preview.
