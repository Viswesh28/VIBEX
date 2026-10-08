# Verification — 7 October 2026

> Follow-up: the requested AI-icon, side-by-side testing APK is now delivered. See [TEST_APK.md](TEST_APK.md) for its identity, installation instructions and current verification; the record below describes the earlier implementation handoff.

Baseline: `ad60995`. Local working-tree implementation; no commit or push.

| Check | Result |
|---|---|
| `npm test` in `music-app` | **16/16 passed**: queue bounds/shuffle/repeat, backup validation/merge/round-trip, legacy totals, imported lyric timing, statistics, settings, discovery and skip accounting. |
| `npm run build` | **Passed**, 1,909 transformed modules; main JS 247.88 kB (77.90 kB gzip), CSS 43.63 kB. Existing embedded API chunk remains 557.02 kB. |
| `npm run test:e2e` against the newly built gateway | **8/8 passed**, 7.3 seconds. Chromium with mocked catalog/LRCLIB and a real HTML Audio WAV fixture. |
| `npx cap sync android` | **Passed** after final frontend build; Android assets contain the v2 UI. |
| `:app:assembleDebug` | **Passed**. Development APK generated as a verification artifact, not a production release/delivery. |
| `:app:testDebugUnitTest` | **Passed**: 5 focused `ListeningLedgerTest` tests plus the existing template unit test. |
| `:app:lintDebug` | **Passed: 0 errors, 33 warnings**. No broad baseline or error suppression was used to bypass Media3 opt-in errors. |
| Combined final Gradle run | **BUILD SUCCESSFUL in 36 seconds**, 196 tasks (34 executed, 15 cached, 147 up-to-date). Java 21, SDK 35, one worker with memory bounds. |
| Latest live-catalog browser smoke | Six visible tracks, **0 page errors**, **no horizontal overflow at 393 px**. Desktop/mobile screenshots captured and visually reviewed. This is not a native streaming test. |
| Device/emulator runtime | **Not run.** Android acceptance remains open; see `DEVICE_QA.md`. |

## Browser integration coverage

1. Responsive navigation at widths 320/360/393/412 and landscape 851; honest web-only/offline explanation.
2. Like, playlist creation, duplicate feedback and persistence across reload.
3. Search, real HTML Audio transport, queue controls/bounds and timed lyrics.
4. Non-destructive legacy migration and backup export.
5. Theme preferences and genuine imported word timestamps.
6. Expanded-player focus trap, background inertness and Escape focus restoration.
7. Invalid backup rejection; valid replace/restore surviving reload.
8. Lyrics priority reversal actually choosing an online source before imported text.

## Native accounting coverage

Paused/buffering intervals excluded; one play after five seconds; track-change flush; suspended-tick cap; short/failed plays not counted as full plays. These are JVM accounting tests, not Media3/device integration tests.

## Remaining warnings and limitations

- Vite reports a large embedded API chunk and mixed static/dynamic Capacitor imports.
- Android lint warnings include dependency-update suggestions, widget hardcoded labels/style, existing launcher/resources, an intentional exported media service, static service reference, and legacy protocol DES/ECB usage for the provider URL format. Zero lint errors is not a security certification.
- During validation, an initial concurrent build exceeded the small runner's resources; a later lint attempt hit a metaspace limit. Final checks succeeded sequentially with adequate metaspace. These failed attempts are not counted as successful tests.
- See `ANDROID_V2.md` for product boundaries, particularly one online lyric provider, bounded radio, optional/unimplemented normalization, local file portability, history retention and device-specific behavior.
