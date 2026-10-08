# Vibex 2.0-test2 — branding and practical improvements

> Superseded by [Vibex 2.0-test4](TEST4.md). The information below describes the historical test2 build.

## Requested changes

- App/launcher/activity display name: **Vibex** (including the test build).
- Settings footer: **Made with ❤️ by VISWESHSARAVAN**.
- Removed the top-right circular V/profile placeholder. The actual launcher icon and left-hand branding remain.

## Added, with the user's approval

1. **Recent searches:** up to eight searches, with song/album/artist/playlist category remembered. Submit with the keyboard or play/open a result to save one. Tap a recent item to repeat it; Clear history removes the list. History stays on-device and is excluded from portable JSON backups.
2. **Download badges in song lists:** completed offline copies are distinguished from queued, paused, downloading, failed and removing states. Only Media3's completed state is marked downloaded.

## Performance and reliability work

- Bounded session-only catalog cache: 32 entries, 90-second TTL, shared in-flight requests, no cached failures. Stream URL resolution still bypasses this cache.
- Native UI polling is single-flight, stops scheduling new polls while the WebView is hidden, and resumes on return. Native music/download services continue independently.
- Avoids unchanged auxiliary-state updates and preserves stable queue references for memoized artwork components.
- Native song metadata has a 256-entry immutable-string cache, reducing repeated SQLite reads and identical writes. Cache is invalidated after backup-restore transactions, including rollbacks.
- Removed the library-save debounce after a regression test exposed lost edits on rapid reload. User edits now enter the serialized persistence queue immediately.

These are concrete reductions in duplicate work, not a claim of measured FPS/battery improvements on every phone.

## Update installation

**Install `Vibex-2.0-test2.apk` over the previously supplied `VIBEX-2.0-test1.apk`. Do not uninstall first.**

- Same package: `dev.viswesh.vibex.testing`.
- Same signing certificate as the supplied test1 APK, verified directly against both files.
- Version code increased from 3 to **4**; version name **2.0-test2**.
- Existing test-app data should be retained through Android's normal update installation. This is not a replacement for the separate original `dev.viswesh.vibex` app.
- Android 6.0/API 23 minimum, target API 35. Development/debug signed, not a production release.

If Android reports a signature conflict, report the exact message rather than uninstalling and losing data.

## Checks completed

- **23/23 core tests passed**, including cache TTL/eviction/deduplication/retry, visible-only single-flight polling, private search history and download status rules.
- **11/11 browser integration tests passed** against the final production bundle, including creator credit, removed avatar, recent-search persistence/replay/clear, and catalog navigation reuse.
- Catalog integration test: initial Home makes two catalog requests; two subsequent returns to Home make **zero additional catalog requests** while the cache is fresh.
- Java/native unit task passed: five focused accounting tests plus the existing template test.
- Android assembly and lint passed: **0 lint errors, 33 warnings**; final combined Gradle run completed in 49 seconds.
- APK signature and ZIP alignment verified. Packaged label, version, creator credit and web assets checked.
- Live-catalog browser smoke: no page errors, no horizontal overflow at 393 px. Home and Settings screenshots visually reviewed.
- This revision has not been installed on a physical phone here. Recheck background playback, downloads and update/data retention on your phone.

APK SHA-256: `2305fc48134b562a0b344009966eb7c3be4122697cbbb4a1a52826f87a4239e1`.

Screenshots: [Home](screenshots/test2/home.png) · [Settings credit](screenshots/test2/settings-credit.png).

No commits, pushes or store publication were performed. Existing release-readiness and dependency-review caveats still apply.
