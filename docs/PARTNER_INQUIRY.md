# Provider Licensing Inquiry, Data Retention & Compliance Guide

This document collects the operational materials needed before enabling any
commercial catalog, on-demand stream resolver, or OAuth account integration in
VIBEX.

---

## 1. Ready-to-Send Provider / Rights-Holder Inquiry

**Subject:** Request for authorized music catalog and playback integration — VIBEX

Hello [Provider / Partnerships Team],

We are building **VIBEX**, a web and mobile (PWA / Android Capacitor) music
application initially serving listeners in [target territories, e.g. India and
global English markets]. We would like to integrate your catalog and playback
services under an approved commercial or developer agreement.

Could you confirm whether you offer an authorized API/SDK or partner program
covering:

1. **Catalog search and metadata** — tracks, albums, artists, playlists,
   artwork, canonical identifiers, explicit content flags, pagination cursors,
   and availability by territory.
2. **On-demand playback in a third-party client** — required player/SDK,
   supported platforms (Web MSE/EME, iOS Safari, Android), audio codecs and
   bitrates, and any DRM / license-server requirements (Widevine / FairPlay).
3. **User sign-in and delegated library access** — OAuth 2.0 / PKCE scopes,
   account linking, and cursor-based pagination or webhooks for user likes and
   playlists.
4. **Offline playback, caching, background playback, casting, and lock-screen
   controls**, if permitted under your agreement.
5. **Advertising, subscription/entitlement checks, attribution, play reporting,
   royalties, and mandatory UI/branding guidelines.**
6. **Content restrictions, territory windows, takedown obligations, rate limits,
   metadata cache TTLs, data retention limits, and security requirements.**
7. **Commercial terms** — minimum guarantees, per-stream or revenue-share
   royalty model, launch review, and permitted business models.

We do **not** collect user passwords, scrape browser cookies, persist raw
expiring stream URLs, or bypass access/DRM controls. Our client architecture
isolates catalog browsing (`CatalogProvider`), stream resolution
(`StreamResolver`), and opt-in delegated library sync (`AccountProvider`) behind
strict adapter boundaries (`music-app/src/lib/providers.js`).

We can share an architecture diagram, data-flow and threat-model summary,
expected usage, target territories, and live builds for review. Please direct us
to the appropriate technical and licensing contacts and written API
documentation.

Regards,  
[Name / Organization / Contact Email]

---

## 2. Privacy, Retention & Security Summary

| Category | What VIBEX stores | Where it lives | Retention & deletion |
| --- | --- | --- | --- |
| **Catalog metadata cache** | Search, track, and playlist metadata (`TrackSummary`) | In-memory `MetadataCache` (`5 min` TTL, max `150` entries) | Cleared automatically on tab close or TTL expiry |
| **Playback URLs & tokens** | Short-lived `ResolvedPlayback` URIs & headers | Transient runtime memory only | **Never persisted** (`sanitizeTrackForPersistence` strips `?expire=` URLs, headers, and tokens before any `localStorage` write) |
| **Queue & resume position** | Sanitized track metadata + playhead offset (`svSession`, `svResume`) | Device `localStorage` | `7 day` TTL (`SESSION_TTL_MS`), or immediate clear via queue clear |
| **Local likes & playlists** | User-saved track references (`svLiked`, `svPlaylists`) | Device `localStorage` | Exportable as portable `.json`; erasable anytime via **Settings → Delete library copy** |
| **Listening history & taste** | Play counts and elapsed seconds (`svStats`, `svDismissed`) | Device `localStorage` (suppressed when **Private session** is on) | Erasable anytime via **Settings → Reset history** |
| **Delegated account sync** | Opaque `authStateRef`, `SyncState` cursor, and `svRemoteMirror` | Device storage (opt-in only; disabled unless an OAuth `AccountProvider` is configured) | Pausable; **Disconnect account** revokes session; **Delete library copy** wipes mirror and cursors |

### Threat Model Invariants

* **Zero password or cookie capture:** `createAccount` throws immediately if fed
  `password`, `cookie`, `SAPISID`, `SAPISIDHASH`, or raw `Bearer` tokens.
* **Redacted diagnostics:** `redactUrl` and `redactResolvedPlayback` strip
  `sig`, `token`, `key`, `pot`, userinfo, and `requestHeaders` from diagnostic
  objects so secrets never leak into logs or telemetry.
* **Non-destructive sync:** Remote sync writes into `svRemoteMirror` and commits
  the pagination cursor strictly *after* storage writes succeed. Partial or
  failed syncs never delete local favorites or playlists.
* **Honest entitlement handling:** `AuthorizationRequired`,
  `NotAvailableInRegion`, and `Rights/DRM` errors halt immediately without
  auto-retry loops and without silently substituting a different recording.

---

## 3. User-Facing Notice (Draft — Requires Legal Review Before Commercial Launch)

> **Independent service notice.** VIBEX is an independent application and is not
> affiliated with, endorsed by, or sponsored by Google, YouTube, YouTube Music,
> JioSaavn, or any music provider unless a written agreement expressly states
> otherwise. Provider names and marks belong to their respective owners.
>
> Catalog access and playback are provided only through services and content for
> which the app has authorization. Availability depends on provider, territory,
> account entitlements, and rights. Users must follow applicable service terms
> and copyright law. The app does not grant rights to download, copy,
> redistribute, or publicly perform recordings. Account linking is optional and
> uses provider-approved authorization only.
>
> *Note: This notice is an operational draft and does not establish a license,
> partnership, or legal compliance. Obtain qualified legal review and written
> provider/rights-holder agreements before commercial distribution.*
