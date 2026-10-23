# NOTICE — Third-Party Components & Attribution

VIBEX is built on, and depends on, the following third-party work. All
trademarks, service marks, and trade names mentioned belong to their
respective owners.

---

## 1. Vendored source code (in this repository)

### jiosaavn-api

| | |
|---|---|
| **Component** | `jiosaavn-api/` (entire directory) |
| **Upstream project** | [sumitkolhe/jiosaavn-api](https://github.com/sumitkolhe/jiosaavn-api) |
| **Original author** | **Sumit Kolhe** |
| **Original copyright** | Copyright (c) 2024 Sumit Kolhe |
| **License** | MIT — full text at [`jiosaavn-api/LICENSE`](jiosaavn-api/LICENSE) |
| **Modifications made here** | Converted from TypeScript to JavaScript (build step removed); added `run-local.mjs` for local execution. No upstream functionality was removed. |

This project is a **fork** and is redistributed under the terms of the
original MIT license. The original copyright notice and license text are
preserved unmodified in `jiosaavn-api/LICENSE` and `jiosaavn-api/package.json`.

All credit for the API wrapper, its request logic, decryption helpers, and
data models belongs to **Sumit Kolhe**. VIBEX adds only the front-end and the
gateway that consumes it.

Upstream project: <https://github.com/sumitkolhe/jiosaavn-api>

---

## 2. Runtime dependencies of `jiosaavn-api/`

| Package | License | Author / Owner |
|---|---|---|
| `hono` | MIT | Hono |
| `@hono/node-server` | MIT | Hono |
| `@hono/zod-openapi` | MIT | Hono |
| `@hono/zod-validator` | MIT | Hono |
| `@scalar/hono-api-reference` | MIT | Scalar |
| `zod` | MIT | Colin McDonnell |
| `node-forge` | **BSD-3-Clause OR GPL-2.0** (dual-licensed; this project uses it under **BSD-3-Clause**) | Digital Bazaar, Inc. |

---

## 3. Client-side libraries

The front-end in `music-app/` is a React application built with Vite.

| Package | License | Author / Owner |
|---|---|---|
| `react` | MIT | Meta Platforms, Inc. and affiliates |
| `react-dom` | MIT | Meta Platforms, Inc. and affiliates |
| `vite` | MIT | Evan You and Vite contributors |
| `@vitejs/plugin-react` | MIT | Evan You and Vite contributors |

Nothing is loaded from a CDN at runtime: React is bundled into the hashed
assets under `music-app/dist/assets/`, which the gateway serves same-origin.

Everything else in the UI — the dual-deck crossfading player, the canvas
visualizer, the LRC parser and lyrics sync, and the ID3/MP4 tag writer in
`music-app/tagger.mjs` — is hand-written with no further dependencies.

---

## 4. External data services (called at runtime, not bundled)

| Service | What is fetched | Note |
|---|---|---|
| **JioSaavn** (`www.jiosaavn.com`) | Audio stream URLs, song/album/artist/playlist metadata, album artwork | Accessed via the unofficial wrapper above (`CatalogProvider` + `StreamResolver`). JioSaavn is a service of Reliance Industries / JioSaavn Media Pvt. Ltd. **This project is not affiliated with, endorsed by, or sponsored by JioSaavn.** |
| **YouTube Music / YouTube** (`music.youtube.com`, `www.youtube.com/embed`) | Public song search metadata (`api/ytmusic.mjs`) and official embedded video playback (`YouTubeEmbed.jsx`) | **No audio streams or browser cookies are extracted.** YouTube items open exclusively in YouTube's official IFrame player subject to YouTube's controls, ads, and rights-holder embed restrictions (ADR 0007 / ADR 0008). **Not affiliated with, endorsed by, or sponsored by Google LLC or YouTube.** |
| **saavn.dev** | Nothing — see note | The public hosted instance of the same wrapper. It is **not** called by VIBEX; the name appears only inside the vendored fork's own documentation strings (`jiosaavn-api/src/app.js`, `src/pages/home.js`). There is no cloud fallback: if the local API is unreachable the UI shows its offline screen. |
| **LRCLIB** (`lrclib.net`) | Synced and plain-text song lyrics | Community-maintained, keyless lyrics database. Displayed with on-screen credit ("Lyrics by LRCLIB"). **Lyrics remain the property of their publishers and rights holders.** |

---

## 5. Content that is NOT licensed by this project

The following are retrieved on demand from the services above and are **never
stored, bundled, cached to disk, or redistributed** by this repository:

- Sound recordings and master audio
- Musical compositions
- Album artwork and artist imagery
- Song lyrics
- Artist biographies and other metadata

All such content remains the exclusive property of the respective record
labels, artists, publishers, photographers, and other rights holders.

---

## 6. README screenshots

The images under `docs/screenshots/` are static UI previews included for
documentation only. They are not loaded by the application and contain no
audio, artwork catalogue, lyrics, or other streaming media.

---

If you are a rights holder and believe any component above is attributed
incorrectly, or that content associated with this project infringes your
rights, please see **[DMCA.md](DMCA.md)** and **[docs/PARTNER_INQUIRY.md](docs/PARTNER_INQUIRY.md)**.

---

## 7. Independent Service Notice (Draft)

VIBEX is an independent application and is not affiliated with, endorsed by, or
sponsored by Google, YouTube, YouTube Music, JioSaavn, or any music provider
unless a written agreement expressly says otherwise. Provider names and marks
belong to their respective owners.

Catalog access and playback are provided only through services and content for
which the app has authorization. Availability depends on provider, territory,
account entitlements, and rights. Users must follow applicable service terms
and copyright law. Account linking is optional, disabled by default unless an
authorized OAuth provider adapter is configured, and never collects passwords
or browser cookies.

