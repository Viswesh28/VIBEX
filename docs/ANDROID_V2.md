# VIBEX 2 — Android-first implementation

> Follow-up: the requested AI-icon, side-by-side testing APK is now delivered. See [TEST_APK.md](TEST_APK.md) for its identity, installation instructions and current verification; the record below describes the earlier implementation handoff.

Local implementation against baseline `ad60995`. No commit, remote push, release signing, or publication was performed. The separate VIBEX-APK repository is unchanged.

## Product and architecture

An independently authored, Echo-inspired light/dark interface keeps VIBEX branding: four mobile navigation destinations, a persistent mini-player, an expanded player, a queue, lyrics, and consistent track menus. Desktop has side navigation and a queue panel. This is not a copy of Echo/SimpMusic code, logos, or GPL-covered assets.

React + Capacitor + JioSaavn remain. On Android, Media3 owns playback, media sessions, queue, audio focus, crossfade, sleep timer, and listening accounting; the WebView polls native snapshots. HTML Audio is constructed **only on the web**. Existing catalog, tagging/export, gateway, and embedded native HTTP code are reused.

### Scope ledger

“Implemented” below means code is wired into the app, **not** that Android device acceptance tests have passed.

| # | Area | Implementation and boundaries |
|---|---|---|
| 1 | Background/system playback | Media3 foreground media-session service; notification/session metadata; system transport; audio focus, ducking, noisy-output pause; optional stop on Recents dismissal. Real-device verification required. |
| 2 | Queue/resume | Enqueue/play-next, select, reorder/remove, keep-current clear, shuffle/repeat, seek, dual-deck crossfade, sleep timer. Android session saved every five seconds and at explicit edits; restored paused. |
| 3 | Managed downloads | Media3 download index; progress, pause/resume/retry/remove; two concurrent downloads; unmetered-network preference; separate managed and temporary caches; downloaded-copy lookup before online resolution. Explicit tagged export remains separate. |
| 4 | Persistence/backup | App-private SQLite on Android, IndexedDB on web; non-destructive legacy migration; versioned JSON backup validation; merge/replace; Android restore transaction. Backup includes imported lyrics and legacy totals, excludes audio files, local URI grants, stream URLs, and transient queue/cache. |
| 5 | Lyrics | Ordered local-import, LRCLIB exact, LRCLIB matched-search sources; enable/disable/reverse priority; title/artist/duration checks; cancellation/timeouts; line seeking and timing offset; enhanced LRC word timestamps. LRCLIB is **one** online provider, not two independent services. |
| 6 | Mobile UI | Bottom navigation, compact/expanded player, swipe-down collapse, responsive layouts, light/dark themes, labels, modal focus trapping/background inertness, reduced motion and safe-area styling. Real TalkBack/large-font testing remains. |
| 7 | Library/playlists | Likes, recent/local collections, playlist CRUD, duplicate feedback, list search/sort, persisted playlist reordering, multi-select queue/download/remove actions. |
| 8 | Discovery | Language/genre/mood-based catalog queries, resume/recent sections, liked-artist and measured-listening signals, recent/explicit-short-skip penalties, bounded artist-radio mix with exhaustion feedback. No endless background auto-refill. |
| 9 | Statistics | Actual playing samples; play marker after five credited seconds; pause/buffering excluded; native monotonic clock; bounded delayed samples; top songs/artists, rolling 24-hour/7/30/365-day summaries; collection switch and clear-history action. |
| 10 | Audio preferences | Flat/bypass, Bass boost, Vocal, Bright; native device Equalizer and web Web Audio filters; persistent quality/EQ/crossfade preferences. Normalization is not fabricated without loudness data. |
| 11 | Local files | Android system document picker, persisted URI permissions, metadata and bounded embedded-art extraction, playlists, unreadable-file feedback. No broad storage scan permission. Web-selected files are session-only. |
| 12 | Widget | Basic Android home-screen title and previous/play-pause/next widget, plus tap-to-open. If the service is absent it opens the app rather than claiming reliable cold background startup. |

## Source map

- `music-app/src/main.jsx`: v2 entry point; native HTTP bootstrap.
- `music-app/src/v2/App.jsx`: shell/navigation; `HomeView`, `SearchView`, `DetailView`, `LibraryView`, `DownloadsView`, `StatsView`, `SettingsView`: separate screens.
- `music-app/src/v2/Player.jsx`, `Dialogs.jsx`, `ui.jsx`, `theme.css`: player, lyrics, queue, shared components and styling.
- `music-app/src/v2/Model.jsx`: application state, platform routing, native snapshot/download/event refresh.
- `music-app/src/v2/core.js`: pure queue, backup, settings, lyric matching/parsing, discovery and statistics rules.
- `music-app/src/v2/storage.js`: serialized storage adapter and legacy migration.
- `music-app/src/v2/browser-player.js`, `native.js`, `lyrics.js`: web playback, bridge, lyrics providers.
- `music-app/android/app/src/main/java/dev/viswesh/vibex/audio/`: native service, bridge, media/download caches, SQLite store, listening ledger, artwork cache and widget.
- `music-app/tests/`: core and Chromium integration tests.
- `music-app/android/app/src/test/java/dev/viswesh/vibex/audio/ListeningLedgerTest.java`: native accounting tests.

The former UI/player sources remain in the repository for review and rollback, but are not imported by the active entry point. This avoids mounting two playback engines. Legacy visualizer controls are not part of the new UI.

## Persistence and migration details

- Existing `svLiked`, `svPlaylists`, `svStats`, theme, shuffle/repeat, data-saver and crossfade preferences are read on first migration. Legacy localStorage is not deleted by migration. Explicit clear-history removes the old `svStats` key as well.
- Old cumulative statistics are displayed separately, preserved in backups, and never reinterpreted as precisely timed new events.
- Unknown document versions fail closed rather than overwriting the library. SQLite upgrades deliberately refuse destructive migration; add an explicit migration when the database schema changes.
- Native queue/session and download index are independent of the WebView library document.
- Local document grants are not portable. Previously exported audio can be re-imported with the system picker. Moving a document or revoking access requires re-selection.
- Merge deduplicates playlist membership and matching event records, retains current preferences, and combines imported lyrics. Replace preserves existing local-song records and does not delete audio downloads; remote library data and statistics are replaced.
- Backups are unencrypted JSON user exports. They contain library/history information: store/share them accordingly. No login or account credentials are needed.

## Media and accounting boundaries

- Managed offline files use app-private storage, are not evicted by the temporary stream cache, and survive app restarts. They do not survive uninstall/clear-data.
- Stream cache defaults to 128 MB, configurable within supported bounds; size changes require process restart. Artwork is separately bounded to 64 MB with stale offline fallback and 24-hour refresh. Ordinary audio downloads do not cross the JavaScript bridge as base64.
- Cache keys include bitrate. Only a completed offline copy can override the requested streaming quality. A partial copy of another bitrate is never concatenated with the stream.
- Retrying an existing download retains its original quality. Remove that copy first to download a different quality. Start a new queue to apply a new streaming quality on Android.
- “Wi-Fi only” is implemented using Android's **unmetered-network** requirement; metered Wi-Fi may wait and unmetered Ethernet may qualify.
- Successful lyric views are cached (150 ordinary entries plus up to 1,000 protected downloaded-track entries). Lyrics are not guaranteed for every recording and are not automatically fetched in a headless download job. User-imported lyrics remain separate and are included in backups.
- Native listening time is credited to the outgoing/current deck until crossfade promotion; web attributes to the incoming track once its crossfade starts. Neither intentionally double-counts overlap. Native samples may conservatively undercount boundary intervals. A process kill may lose the current unflushed batch (up to roughly 30 seconds).
- History is bounded to the last 10,000 event records, not guaranteed full-year retention. Explicit short-skip signals cover in-app skip/select and widget commands, not every external controller.
- No service can guarantee playback after force-stop or under every manufacturer's battery restrictions. Android 15+ foreground-service/audio-focus restrictions must be device-tested.

## Reproduce

Use Node 20+ and Java 21. Keep `jiosaavn-api` beside `music-app`; it is a local package dependency. For Android, install SDK 35 and configure `ANDROID_HOME` or your own `android/local.properties`.

```bash
# From repository root
cd jiosaavn-api
npm ci
cd ../music-app
npm ci
npm test
npm run build

# Gateway/browser preview (catalog API should run separately on port 3001)
PORT=8000 API_TARGET=http://127.0.0.1:3001 npm run serve
```

The backend's existing startup/deployment instructions remain in the root README. Browser integration tests mock catalog/lyrics/media responses, but exercise real DOM, IndexedDB and HTML Audio. With the built gateway running at port 8000:

```bash
cd music-app
npx playwright install chromium
# Linux runners may also need: npx playwright install-deps chromium
npm run test:e2e
# Override a running test origin with VIBEX_TEST_URL when needed.
```

```bash
cd music-app
npm run android:sync  # build web assets, then sync Capacitor
cd android
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

On a 2 GB runner, use one Gradle worker and avoid concurrent Vite/Chromium jobs:

```bash
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug \
  --no-daemon --max-workers=1 \
  '-Dorg.gradle.jvmargs=-Xmx512m -XX:MaxMetaspaceSize=512m -XX:ReservedCodeCacheSize=64m -XX:+UseSerialGC'
```

The APK produced by `assembleDebug` is a development artifact, not a signed production release. Production signing/versioning and store delivery were not requested or configured.

## Verification and release gate

See `DEVICE_QA.md` for Android acceptance checks. Automated evidence does not substitute for them. Current verification results are recorded in the accompanying implementation handoff.

Expected non-blocking Vite warnings: the existing embedded API chunk exceeds 500 kB, and Capacitor is both statically and dynamically imported. Native Media3 unstable APIs are explicitly opted into and dependencies are pinned; review before upgrading Media3.

Deferred integrations remain deferred: social/account sync, Discord, recognition, weather/LLM recommendations, video, advanced DSP/USB, Android Auto, casting/shared listening, and a desktop/iOS rewrite. No normalization or universal offline lyric coverage is claimed.
