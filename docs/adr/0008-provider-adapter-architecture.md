# 0008 — Provider adapter architecture, state machine, and opt-in sync

* Status: **Accepted**
* Date: 2026-10-23
* Supersedes: remaining extraction remnants from [ADR 0004](0004-device-stream-mint.md)
  and [ADR 0005](0005-web-mint-extension.md) (`extension/`, `CanvasMintPlugin.mintStream`)
* Relates to: [ADR 0007](0007-embed-only-youtube.md) (embed-only YouTube playback)

## Context

Reference Android/KMP clients such as Echo Music and SimpMusic obtain tracks
from YouTube Music by pairing anonymous InnerTube browsing with WebView session
cookies (`SAPISIDHASH`) for library sync, resolving transient stream URLs on the
client and handing them to Media3/ExoPlayer.

That approach relies on undocumented endpoints and bearer-like browser cookies
that have no stability guarantee and confer no licensing right to stream master
audio. ADR 0007 already deleted `src/lib/ytStream.js`, yet two remnants stayed
in the tree:

1. `extension/` — the unpacked browser extension shimming `XHR`, `fetch`, and
   `MediaSource` on `music.youtube.com`.
2. `CanvasMintPlugin.mintStream` — dead stream-extraction code in the Android
   WebView plugin.

Meanwhile, the reference provider-approved architecture cleanly separates
catalog browsing, playback resolution, and opt-in account synchronization behind
replaceable provider interfaces so any licensed SDK or contract-approved API can
plug in without rewriting presentation state or persistence.

## Decision

1. **Remove every remaining stream-scraping artifact.** `extension/` is deleted,
   and `CanvasMintPlugin.java` retains only `mint()` + `dispose()` for canvas
   metadata lookup (`setMediaPlaybackRequiresUserGesture(true)`).
2. **Port the Kotlin reference interfaces into pure, contract-checked JS
   modules** matching this repository's React + Vite + Node/Capacitor stack:

| Reference design (Kotlin) | VIBEX implementation |
| --- | --- |
| `CatalogProvider` (`search`, `getTrack`, `getPlaylist`) | `src/lib/providers.js` (`createJioSaavnCatalogProvider`, `createYtMusicCatalogProvider`, `MetadataCache`) |
| `StreamResolver` (`resolve -> ResolvedPlayback`) | `src/lib/providers.js` (`createJioSaavnStreamResolver`, `createYtMusicEmbedResolver`, `createProviderRegistry`) |
| `AccountProvider` (`signIn`, `syncLibrary`, `signOut`) | `src/lib/providers.js` + `src/lib/sync.js` (`runLibrarySync`, `mergeLibraryViews`) |
| `Track`, `Album`, `Playlist`, `QueueEntry`, `Account`, `SyncState` | `src/lib/models.js` — composite `<provider>:<id>` keys, `sanitizeTrackForPersistence`, `redactResolvedPlayback` |
| `Idle → Resolving → Ready → Buffering → Playing ↔ Paused → Ended` | `src/lib/playbackState.js` + `PlayerContext.jsx` + `YouTubeEmbed.jsx` |

3. **Enforce strict persistence and credential boundaries:**
   * Composite keys (`<provider>:<providerTrackId>`) prevent collisions across
     catalogs.
   * `sanitizeTrackForPersistence` strips transient `_resolvedPlayback`, auth
     headers, and raw expiring URLs (`?expire=` / `?expires=`) before writing
     `svSession`, `svLiked`, `svPlaylists`, or `svRemoteMirror`. Restored items
     re-resolve fresh playback references through `StreamResolver` on demand.
   * `createAccount` rejects passwords, raw cookies, `SAPISIDHASH`, and raw
     bearer tokens; only opaque secure-storage handles (`authStateRef`) are
     accepted.
4. **Enforce honest failure semantics:**
   * All seven failure categories (`NetworkRetryable`,
     `ExpiredPlaybackReference`, `AuthorizationRequired`,
     `NotAvailableInRegion`, `Rights/DRM`, `UnsupportedFormat`,
     `ProviderUnavailable`) map explicitly in `classifyPlaybackFailure`.
   * `ExpiredPlaybackReference` re-resolves **at most once** per track and never
     loops. Authorization, region, and DRM blocks never auto-retry and never
     silently substitute a different song.
5. **Enforce conservative, resumable opt-in sync:**
   * `runLibrarySync` requires explicit user consent naming the collections read
     (`liked`, `playlists`), commits `SyncState.cursor` **only after** page
     writes succeed, keeps `svRemoteMirror` separate from local favorites, and
     never deletes local-only items on partial, failed, or full syncs.
   * Settings exposes portable JSON library export, two-step local deletion, and
     pause/resume/disconnect controls alongside the independent service notice.

## Consequences

* No code anywhere in the repository intercepts `googlevideo.com` URLs or reads
  browser cookies.
* Local gateway (`music-app/server.mjs`) now mounts `/api/ytmusic`,
  `/api/canvas`, and `/api/dl` directly for full parity with Vercel.
* Adding a licensed music provider requires registering one `CatalogProvider`,
  one `StreamResolver`, and (optionally) one OAuth `AccountProvider` in
  `createProviderRegistry()`.
