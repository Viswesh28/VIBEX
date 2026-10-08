# VIBEX Test — AI-icon testing build

> Superseded by [Vibex 2.0-test4](TEST4.md). The original build information below is retained for reference.

This follow-up build was requested for manual Android testing. It includes the user's selected AI-generated VIBEX launcher artwork.

## Installation identity

- App label: **VIBEX Test**
- Package: `dev.viswesh.vibex.testing`
- Version name: `2.0-test1`; version code: `3`
- Minimum Android API: 23 (Android 6.0); target API: 35
- Signing: development/debug certificate, **not a production signing key**
- The debug application ID is separate from `dev.viswesh.vibex`, so it can coexist with the ordinary app without replacing its data.
- Test-app library and managed downloads start separately. They do not automatically migrate from the ordinary app. Import a compatible VIBEX v2 JSON backup if available, and re-select local files when needed. In-place upgrade migration still requires a same-package, same-signature build and is not tested by this side-by-side APK.

## Install and test

1. Download the supplied APK onto your Android phone and open it from Files/Downloads.
2. If prompted, allow that browser/file manager to install this APK. You can revoke that source's install permission afterwards.
3. Open **VIBEX Test**, identifiable by the new purple/white V music icon. Streaming/search require internet; the native app does not require a separately running desktop server.
4. Allow notifications when testing playback/download notifications. For initial download tests, use an unmetered connection or turn off the Wi-Fi-only preference.
5. Start with search/play/pause, then screen lock/background playback, downloaded playback in airplane mode, local files, lyrics, EQ and widget controls. See `DEVICE_QA.md` for the full checklist.
6. Report your phone model, Android version, steps and any error/screenshot when something fails.

Do not uninstall your ordinary VIBEX app to install this build. If an older **VIBEX Test** installation conflicts because of a different signing key, back up its data before considering removal. Do not bypass a security warning you do not understand; report the exact warning first.

## Icon assets

Original selected AI image: `music-app/assets/branding/vibex-ai-icon.png`. The standalone deliverable is `VIBEX-app-icon.png`.

Generated Android assets include all five density buckets, legacy/round icons, adaptive foreground/background layers, and Android 13+ monochrome themed-icon support. Source artwork is unchanged; launcher assets remove the generated outside corners and separate the mark for platform masks.

Rebuild the icon assets with Python, Pillow and NumPy:

```bash
cd music-app
python scripts/build_launcher_icon.py
npm run android:sync
cd android
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

This is a manual-testing build, not a production release or a claim of real-device verification. Existing dependency audits still report an upstream node-forge advisory; release security/dependency review remains open. No commits, pushes or app-store publication were performed.

## Delivered artifact verification

- `VIBEX-2.0-test1.apk`: 7,927,344 bytes (approximately 7.6 MiB).
- SHA-256: `16d5df08764884c5890a3ac96a6fc33efeef2abc1ed2e8ffabb5480712fad4f2`.
- APK signature verified (v1 and v2); ZIP alignment verified.
- Actual packaged app ID, label, version and minimum SDK checked with Android build tools.
- Final web assets confirmed inside the APK; 32 launcher-related resources packaged.
- Final Gradle assembly, native unit tests and lint passed in 41 seconds. Lint: zero errors, 34 warnings. Core JavaScript tests: 16 passed.
- Not installed on an emulator or physical phone here. Manual device testing remains required.
