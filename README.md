<div align="center">

# 🎵 VIBEX

**A sleek, Spotify-style music player for the web — search millions of songs, stream in high quality, download, and vibe.**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Viswesh28/VIBEX)
![License](https://img.shields.io/badge/license-MIT-green)
![Stack](https://img.shields.io/badge/stack-Node%20·%20Bun%20·%20Docker-blue)

[✨ Features](#-features) · [🚀 Quick Start](#-quick-start) · [☁️ Deploy](#️-deploy-your-own-link) · [🔐 Login Setup](README-FIREBASE.md)

</div>

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
cd jiosaavn-api && PORT=3001 bun run run-local.ts

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
│   └── run-local.ts    # local runner (port 3001)
├── Dockerfile          # single-container build (UI + API together)
├── start.sh            # container entrypoint: starts both servers
├── render.yaml         # one-click Render blueprint
└── setup.sh            # local dependency installer
```

## 🛠️ Tech Stack

- **Frontend:** vanilla JS + CSS in a single file — zero build step, zero framework
- **Gateway:** Node.js (static + `/api` proxy + `/dl` download server)
- **Music API:** Bun + Hono + TypeScript (JioSaavn wrapper)
- **Lyrics:** [LRCLIB](https://lrclib.net) (synced, keyless)
- **Auth + cloud history:** Firebase (optional)
- **Deploy:** Docker → Render / Railway / Fly / any VPS

## ⚠️ Notes

- Music metadata/streams come from an **unofficial** JioSaavn API wrapper — for personal listening.
- High-quality streams are AAC audio (`.m4a`) — the app labels them correctly.
- Downloaded files are for personal, offline enjoyment. Support the artists. 💚

## 📄 License

MIT — do what you want, just keep the vibe. 🎶
