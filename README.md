<div align="center">

# 🎵 VIBEX

**A sleek, Spotify-style music player for the web — search millions of songs, stream in high quality, download, and vibe.**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Viswesh28/VIBEX)
![License](https://img.shields.io/badge/license-MIT-green)
![Stack](https://img.shields.io/badge/stack-Node%20·%20Bun%20·%20Docker-blue)

[✨ Features](#-features) · [🚀 Quick Start](#-quick-start) · [☁️ Deploy](#️-deploy-your-own-link) · [🔐 Login Setup](README-FIREBASE.md) · [⚖️ Legal](#legal)

</div>

> ### ⚖️ Legal notice — please read
>
> VIBEX is an **independent, open-source, non-commercial** project. It is **not**
> affiliated with, endorsed by, or sponsored by **JioSaavn**, Reliance
> Industries, or any record label or streaming service.
>
> This repository **hosts no music**. It contains no audio files, no album
> artwork, and no lyrics. It is a user interface that resolves playback URLs
> on demand through a third-party API and streams them directly from that
> service's own CDN to your browser.
>
> All music, artwork, metadata, and lyrics remain the property of their
> respective **artists, labels, publishers, and rights holders**.
>
> Intended for **personal, private, educational use only**.
> Full terms: [⚖️ Legal & Copyright](#legal) ·
> [Third-party notices](NOTICE.md) · [DMCA / takedowns](DMCA.md)

---

## ✨ Features

| | |
|---|---|
| 🔍 **Deep search** | Songs, albums, playlists & artists with a trending home feed |
| ▶️ **Full player** | Shuffle, repeat, sleep timer, crossfade, queue manager, live spectrum visualizer |
| 🖥️ **Full-screen mode** | Spotify-style immersive view — click any song title to enter |
| 📜 **Synced lyrics** | Karaoke-style line highlighting via the 🎤 mic button |
| ⬇️ **One-click downloads** | Real audio files with correct names, served by a smart retrying backend |
| 🎤 **Artist pages** | Top songs, albums, follower counts, artist radio stations |
| 📻 **Endless radio** | Auto-extending stations seeded from any song |
| 🎵 **Custom playlists** | Create, rename, reorder — saved on your device |
| 📊 **Listening stats** | Plays, minutes, top songs & artists |
| 🔐 **Google login** *(optional)* | Cloud-synced listening history across all your devices |
| 🌗 **Dark / light** | Premium glass UI with a Data Saver mode for slow networks |

## 🚀 Quick Start

**Requirements:** Node 20+, [Bun](https://bun.sh) (one command installs it below).

```bash
# 1. install everything
bash setup.sh

# 2. start the music API (terminal 1)
cd jiosaavn-api && PORT=3001 bun run run-local.mjs

# 3. start the VIBEX UI gateway (terminal 2)
cd music-app && PORT=8000 API_TARGET=http://127.0.0.1:3001 node server.mjs
```

Open **http://localhost:8000** and press play. 🎧

## ☁️ Deploy Your Own Link

One click — free Render hosting, no code changes:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Viswesh28/VIBEX)

Or manually: Render → **New +** → **Blueprint** → select this repo → **Apply**.
Full walkthrough: [README-DEPLOY.md](README-DEPLOY.md).

> 💡 Free-tier servers sleep when idle — the first visit wakes them in ~50s.

## 🔐 Google Login + Cloud History *(optional)*

The app works fully without it. To enable cross-device history:

1. Create a free project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Google sign-in** + **Firestore**
3. Paste the web config into the marked `FIREBASE_CONFIG` line in `music-app/index.html`

Step-by-step with screenshots-level detail: [README-FIREBASE.md](README-FIREBASE.md).

## 📁 Project Structure

```
VIBEX/
├── music-app/
│   ├── index.html      # the entire VIBEX app (UI + player + all features)
│   └── server.mjs      # gateway: serves UI, proxies /api, /dl downloads
├── jiosaavn-api/       # music metadata + stream backend (Bun + Hono)
│   └── run-local.mjs   # local runner (port 3001)
├── Dockerfile          # single-container build (UI + API together)
├── start.sh            # container entrypoint: starts both servers
├── render.yaml         # one-click Render blueprint
└── setup.sh            # local dependency installer
```

## 🛠️ Tech Stack

- **Frontend:** vanilla JS + CSS in a single file — zero build step, zero framework
- **Gateway:** Node.js (static + `/api` proxy + `/dl` download server)
- **Music API:** Bun + Hono + JavaScript (JioSaavn wrapper)
- **Lyrics:** [LRCLIB](https://lrclib.net) (synced, keyless)
- **Auth + cloud history:** Firebase (optional)
- **Deploy:** Docker → Render / Railway / Fly / any VPS

<a id="legal"></a>

## ⚖️ Legal & Copyright — Read Before Deploying

This section exists so that rights holders, hosts, and deployers all know
exactly what this project is. Please read it before you fork or deploy.

### 1. What this project is — and what it is not

| ✅ VIBEX **is** | ❌ VIBEX **is not** |
|---|---|
| An open-source front-end + gateway, MIT-licensed | A music service, store, or label |
| A personal-use tool for your own listening | A commercial or monetised product |
| Independent and unaffiliated with JioSaavn | Official, endorsed, or licensed by anyone |

### 2. This repository hosts **no** copyrighted media

The repository contains **source code only**. It does not:

- store, bundle, or ship any audio file;
- store, bundle, or ship any album artwork, artist photo, or lyric text;
- maintain any index, catalogue, or database of media;
- run any server that persists media to disk.

Playback URLs are resolved **on demand, at the moment of playback**, from a
third-party API, and the audio is streamed **directly from JioSaavn's own CDN**
to your browser. Nothing is copied onto a VIBEX server at any point.

### 3. Trademarks and rights holders

- **JioSaavn®** and the JioSaavn logo are trademarks of their respective
  owners. Used here for **nominative, descriptive purposes only** — to say
  which service the metadata comes from.
- All **songs, compositions, master recordings, album artwork, artist
  imagery, and lyrics** are the exclusive property of their respective record
  labels, artists, publishers, photographers, and other rights holders.
- **Google™** and **Firebase™** are trademarks of Google LLC.
- No affiliation, endorsement, or sponsorship by any of the above is claimed
  or implied.

### 4. Third-party code and attribution

VIBEX stands on other people's work, and they get full credit:

| Component | License | Owner |
|---|---|---|
| `jiosaavn-api/` (vendored fork) | MIT | **Sumit Kolhe** — [upstream](https://github.com/sumitkolhe/jiosaavn-api) |
| Hono, Zod, Scalar | MIT | respective authors |
| `node-forge` | BSD-3-Clause | Digital Bazaar, Inc. |
| Firebase JS SDK | Apache-2.0 | Google LLC |
| Lyrics | — | **LRCLIB**, credited on-screen |

Full details, including what was modified in the vendored fork, are in
**[NOTICE.md](NOTICE.md)**. The upstream MIT license is preserved unmodified at
[`jiosaavn-api/LICENSE`](jiosaavn-api/LICENSE).

### 5. Your responsibility when you deploy this

By deploying your own instance, **you** accept that:

1. **You are responsible for your own compliance** with the copyright law of
   your jurisdiction and with JioSaavn's Terms of Service.
2. **Personal, private use only.** Do not monetise it, do not put ads on it,
   do not sell access, and do not redistribute downloaded audio.
3. **Do not remove these notices.** If you fork this project, keep this
   section, `NOTICE.md`, `DMCA.md`, and the upstream license intact.
4. **The upstream API is unofficial** and may change, break, or be shut down
   at any time, without notice and without liability to anyone.
5. **Downloading** copies a temporary file to your own device for your own
   offline listening. Redistribution of those files is your action and your
   liability — not this project's.
6. Remove the `image-search/` reference screenshots before any public
   distribution (see §7).

### 6. DMCA and takedown requests

If you are a copyright owner and believe something here infringes your rights,
**maintainers will respond — this project has no interest in hosting anything
infringing.**

📩 Open a [GitHub issue](https://github.com/Viswesh28/VIBEX/issues) or contact
the maintainer via their GitHub profile.

Valid notices are acknowledged **within 72 hours**. Full procedure, required
elements under 17 U.S.C. § 512(c)(3), and counter-notification steps are in
**[DMCA.md](DMCA.md)**.

### 7. Action item for maintainers: `image-search/`

The `image-search/` folder holds third-party UI reference screenshots gathered
during design exploration. They are **not used by the app** and are already
excluded from the Docker image via `.dockerignore` — but they are committed to
Git, where they are the one piece of unlicensed third-party media in this
repository.

**Delete the folder before publishing:**

```bash
git rm -r image-search && git commit -m "chore: remove third-party reference images"
```

### 8. Plain-spoken limitation of all the above

**Disclaimers do not create legal protection.** No notice in this file makes
the unlicensed streaming or downloading of copyrighted music lawful, and none
of it guarantees immunity from a takedown, a strike, or a claim. What these
notices genuinely do is (a) give required attribution to the upstream authors,
(b) make clear that no media is hosted here, and (c) give rights holders a
fast, working path to removal.

Nothing in this repository is legal advice. For your own deployment, consult a
lawyer in your jurisdiction — or, better, use a licensed streaming service.

**Support the artists. 💚 Stream officially, buy the music, go to the shows.**

---

## 📄 License

The **source code** of VIBEX is released under the **MIT License** — see
[LICENSE](LICENSE).

That license covers the code only. It grants **no rights whatsoever** to any
music, artwork, lyrics, or trademark — which remain the property of their
respective owners. See [LICENSE](LICENSE) ("Scope of this License"),
[NOTICE.md](NOTICE.md), and [DMCA.md](DMCA.md).
