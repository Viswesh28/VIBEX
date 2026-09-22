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

## 3. Client-side libraries loaded at runtime

| Component | License | Owner | Where |
|---|---|---|---|
| Firebase JS SDK v10.12.0 (`firebase-app-compat`, `firebase-auth-compat`, `firebase-firestore-compat`) | Apache-2.0 | Google LLC | Loaded from `www.gstatic.com` in `music-app/index.html`. **Optional** — the app runs with `FIREBASE_CONFIG = null`. |

Firebase and Google are trademarks of Google LLC. Use of Firebase is subject
to the [Firebase Terms of Service](https://firebase.google.com/terms).

---

## 4. External data services (called at runtime, not bundled)

| Service | What is fetched | Note |
|---|---|---|
| **JioSaavn** (`www.jiosaavn.com`) | Audio stream URLs, song/album/artist/playlist metadata, album artwork | Accessed via the unofficial wrapper above. JioSaavn is a service of Reliance Industries / JioSaavn Media Pvt. Ltd. **This project is not affiliated with, endorsed by, or sponsored by JioSaavn.** |
| **saavn.dev** | Same, as a public fallback API | Third-party hosted instance of the same open-source wrapper. |
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

## 6. Reference material

The `image-search/` directory, if present, contains third-party UI reference
screenshots collected during design exploration. **These images are not part
of the application, are not shipped in the Docker image (see `.dockerignore`),
and are not covered by this project's license.** They should be removed before
any public distribution — see README.md ("Legal & Copyright").

---

If you are a rights holder and believe any component above is attributed
incorrectly, or that content associated with this project infringes your
rights, please see **[DMCA.md](DMCA.md)**.
