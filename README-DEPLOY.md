# VIBEX — Share It As A Link 🚀

Your app runs as **one container**: the music UI + the JioSaavn API together.
Deploy it free on Render and you get a public link like:

```
https://vibex.onrender.com
```

## Step 1 — Put the code on GitHub (5 min)

The code is already committed in this workspace. On your own computer:

```bash
# copy these project folders to your computer first
# (music-app, jiosaavn-api, Dockerfile, start.sh, render.yaml, .dockerignore, .gitignore)

cd path/to/vibex
git init
git add -A
git commit -m "VIBEX music player"
```

Then create a **new empty repository** on https://github.com/new (name it `vibex`),
and push:

```bash
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/vibex.git
git push -u origin main
```

## Step 2 — Deploy on Render (5 min, free)

1. Sign up at https://render.com (GitHub login is easiest).
2. Dashboard → **New +** → **Blueprint** → select your `vibex` repo → **Apply**.
3. Render reads `render.yaml`, builds the Docker image (~3–5 min), and gives you a URL.
4. Open the URL — VIBEX loads with music, downloads, lyrics, everything. Share it. 🎧

## Step 3 — Updating later

```bash
# change code, then:
git add -A && git commit -m "update" && git push
```

Render **auto-redeploys** on every push. No other step needed.

## Good to know

- **Free-tier sleep:** Render's free plan sleeps after ~15 min of no traffic.
  The first visitor then waits ~50 seconds while it wakes up. After that it's fast.
  (Paid $7/mo plan never sleeps. Or use a free uptime-ping service to keep it warm.)
- **No secrets needed:** there are no API keys in this project (music + lyrics APIs are keyless).
- **Custom domain:** Render → service → Settings → Custom Domain (free SSL included).
- **Downloads work on the public link** — in fact better than in the embedded
  preview, because there's no sandbox blocking the save.

## Alternatives (same Dockerfile works everywhere)

- **Railway** (railway.app) — free trial credit, no sleep, very fast cold starts.
- **Fly.io** (fly.io) — generous free tier, needs `fly launch` from terminal.
- **Any VPS** (Hetzner/DigitalOcean ~$4–6/mo) — clone repo, `docker build -t vibex .`,
  `docker run -p 80:8000 vibex`, point your domain at it.

## What's inside

| File / folder   | Purpose                                             |
|-----------------|-----------------------------------------------------|
| `music-app/`    | The VIBEX web UI (`index.html`) + gateway (`server.mjs`) |
| `jiosaavn-api/` | Music API backend (runs on port 3001 internally)    |
| `Dockerfile`    | Builds the single deployable container              |
| `start.sh`      | Starts API + UI gateway together                    |
| `render.yaml`   | One-click Render blueprint                          |
