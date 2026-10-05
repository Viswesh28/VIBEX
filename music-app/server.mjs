// Gateway: serves the built React app + proxies /api/* to the local JioSaavn API.
// Run: npm run build && PORT=8000 API_TARGET=http://127.0.0.1:3001 node server.mjs
// (or `npm start`, which does both).
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { addTags } from './tagger.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8000)
const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:3001'
const API_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS || 15000)
// How long non-HTML static assets may sit in the browser cache (seconds).
const STATIC_MAX_AGE = Number(process.env.STATIC_MAX_AGE || 3600)
// Vite's output. Filenames there are content-hashed, so they can be cached hard.
const STATIC_ROOT = process.env.STATIC_ROOT || path.join(__dirname, 'dist')
// Tagging needs the whole file in memory; stream anything larger than this untagged.
const MAX_TAG_BYTES = Number(process.env.MAX_TAG_BYTES || 80 * 1024 * 1024)
const LYRICS_TIMEOUT_MS = Number(process.env.LYRICS_TIMEOUT_MS || 6000)
// Reject an LRCLIB hit whose runtime is this far from the track we asked for:
// it is a different cut, and its synced timestamps would drift out of step.
const LYRICS_MAX_DRIFT_S = Number(process.env.LYRICS_MAX_DRIFT_S || 15)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mjs': 'text/javascript',
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)

    // The mobile build runs from https://localhost inside a WebView, so every
    // call to this gateway is cross-origin. Answer preflights for the two
    // endpoints it uses; static assets are served from the bundle, not here.
    if (req.method === 'OPTIONS' && (url.pathname === '/dl' || url.pathname.startsWith('/api'))) {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
        'access-control-allow-headers': 'accept, content-type, range',
        'access-control-expose-headers': 'content-disposition, content-length',
        'access-control-max-age': '86400',
      })
      res.end()
      return
    }

    /**
     * Liveness probe for the host (Render/Fly health checks).
     *
     * It deliberately checks the API child too, because the container runs
     * both processes: a gateway that answers 200 while the API is dead would
     * keep a broken deploy marked healthy. Upstream JioSaavn is *not* probed —
     * their outage shouldn't cause our instance to be recycled.
     */
    if (url.pathname === '/healthz') {
      let api = 'down'
      try {
        const r = await fetch(`${API_TARGET}/api/search/songs?query=a&limit=1`, {
          signal: AbortSignal.timeout(4000),
        })
        api = r.ok ? 'up' : `http ${r.status}`
      } catch {
        api = 'down'
      }
      const ok = api === 'up'
      res.writeHead(ok ? 200 : 503, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify({ ok, gateway: 'up', api, uptime: Math.round(process.uptime()) }))
      return
    }

    // --- Proxy API to JioSaavn backend ---
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const target = API_TARGET + url.pathname + url.search
      try {
        const r = await fetch(target, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        })
        const buf = Buffer.from(await r.arrayBuffer())
        res.writeHead(r.status, {
          'content-type': r.headers.get('content-type') || 'application/json',
          'access-control-allow-origin': '*',
          'cache-control': 'no-store',
        })
        res.end(buf)
      } catch (e) {
        // Backend down -> 502 JSON (NOT 404) so the UI can cleanly fall back to cloud
        res.writeHead(502, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
        res.end(JSON.stringify({ success: false, message: 'Local JioSaavn backend unreachable at ' + API_TARGET }))
      }
      return
    }

    // --- Download proxy: same-origin streaming, forces "save file" dialog ---
    // Accepts songId (fresh API-resolved URL + server-side retry) and/or url (direct).
    if (url.pathname === '/dl') {
      const songId = url.searchParams.get('songId') || ''
      let target = url.searchParams.get('url') || ''
      const wantQ = url.searchParams.get('q') || '320kbps'
      const rawName = (url.searchParams.get('name') || 'song').slice(0, 120)
      const deny = (code, message) => {
        res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
        res.end(JSON.stringify({ success: false, message }))
      }
      const CDN_HOSTS = ['saavncdn.com', 'jiosaavn.com', 'akamaized.net', 'akamaihd.net']
      const hostOK = (t) => {
        try {
          const u = new URL(t)
          if (u.protocol !== 'https:') return false
          const h = u.hostname.toLowerCase()
          return CDN_HOSTS.some(x => h === x || h.endsWith('.' + x))
        } catch { return false }
      }
      let songMeta = null
      const songFromApi = async () => {
        if (songMeta) return songMeta
        if (!/^[A-Za-z0-9_-]+$/.test(songId)) return null
        const r = await fetch(`${API_TARGET}/api/songs/${songId}`, { headers: { accept: 'application/json' } })
        if (!r.ok) return null
        const j = await r.json().catch(() => null)
        const d = j && j.data
        songMeta = Array.isArray(d) ? d[0] : (d && d.songs && d.songs[0]) || (d && d.song) || d
        return songMeta
      }
      const songUrlFromApi = async () => {
        const s = await songFromApi()
        const urls = (s && s.downloadUrl) || []
        if (!urls.length) return null
        const hit = urls.find(x => x.quality === wantQ) || urls[urls.length - 1]
        return hit && hit.url
      }
      const fetchCDN = async (t) => {
        const r = await fetch(t, { headers: { 'user-agent': 'Mozilla/5.0' }, redirect: 'follow' })
        const ct = r.headers.get('content-type') || ''
        if (!r.ok || !r.body || ct.includes('application/json') || ct.includes('text/html')) return { err: r.status }
        return { r }
      }
      try {
        // Prefer a fresh API-resolved URL (immune to expired page links)
        if (songId) {
          try { const fresh = await songUrlFromApi(); if (fresh && hostOK(fresh)) target = fresh } catch {}
        }
        if (!target) { deny(400, 'No songId or url given'); return }
        try { new URL(target) } catch { deny(400, 'Bad url param'); return }
        if (!hostOK(target)) { deny(403, 'Host not allowed'); return }
        let got = await fetchCDN(target)
        if (got.err && songId) {
          // CDN refused -> resolve once more (link may have rotated) and retry
          try {
            const fresh = await songUrlFromApi()
            if (fresh && fresh !== target && hostOK(fresh)) { target = fresh; got = await fetchCDN(target) }
          } catch {}
        }
        if (got.err) { deny(502, 'CDN refused (' + got.err + ') - replay the song and retry'); return }
        const r = got.r
        const ct = (r.headers.get('content-type') || '').split(';')[0] || 'audio/mpeg'
        const ext = /mp4|m4a|aac/.test(ct) ? 'm4a' : 'mp3'
        const safe = rawName.replace(/[\\/:*?"<>|\r\n]/g, '').trim() || 'song'
        const headers = {
          'content-type': ct,
          'content-disposition': `attachment; filename="${safe}.${ext}"`,
          'access-control-allow-origin': '*',
          'access-control-expose-headers': 'content-disposition, content-length',
          'cache-control': 'no-store',
        }
        // Buffer the file so we can write real metadata into it. Anything huge,
        // or an explicit ?tags=0, falls through to the original raw stream.
        const clen = Number(r.headers.get('content-length') || 0)
        const wantTags = url.searchParams.get('tags') !== '0'
        if (wantTags && songId && (!clen || clen <= MAX_TAG_BYTES)) {
          try {
            const raw = Buffer.from(await r.arrayBuffer())
            const out = await addTags(raw, ct, await songFromApi(), {
              timeoutMs: LYRICS_TIMEOUT_MS,
              maxDriftS: LYRICS_MAX_DRIFT_S,
            })
            headers['content-length'] = String(out.length)
            res.writeHead(200, headers)
            res.end(out)
            return
          } catch {
            if (res.headersSent) { try { res.end() } catch {} ; return }
            // fall through to an untagged retry below
            const again = await fetchCDN(target)
            if (again.err || !again.r) { deny(502, 'Download failed'); return }
            got = again
          }
        }

        if (clen) headers['content-length'] = String(clen)
        res.writeHead(200, headers)
        const reader = got.r.body.getReader()
        let alive = true
        res.on('close', () => { alive = false; try { reader.cancel() } catch {} })
        for (;;) {
          const { done, value } = await reader.read()
          if (done || !alive) break
          if (!res.write(value)) await new Promise(resolve => res.once('drain', resolve))
        }
        try { res.end() } catch {}
      } catch (e) {
        if (!res.headersSent) deny(502, 'Download proxy failed')
        else { try { res.end() } catch {} }
      }
      return
    }

    // --- Static files (the Vite build) ---
    const p = url.pathname === '/' ? '/index.html' : url.pathname
    let file = path.normalize(path.join(STATIC_ROOT, decodeURIComponent(p)))
    const rel = path.relative(STATIC_ROOT, file)
    if (rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }

    let stat = await fs.stat(file).catch(() => null)
    // Single-page app: anything that isn't a real file falls back to the shell,
    // so a deep link or a refresh still boots the client.
    if ((!stat || !stat.isFile()) && !path.extname(file)) {
      file = path.join(STATIC_ROOT, 'index.html')
      stat = await fs.stat(file).catch(() => null)
    }
    if (!stat || !stat.isFile()) {
      if (!(await fs.stat(STATIC_ROOT).catch(() => null))) {
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('The front-end has not been built yet. Run `npm install && npm run build` in music-app/.')
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }

    const ext = path.extname(file).toLowerCase()
    // Weak validator from size + mtime: cheap, and changes whenever the file does.
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
    const lastModified = stat.mtime.toUTCString()
    // HTML revalidates on every load so edits land instantly; other assets may be
    // held in cache and only revalidated once stale.
    // Vite fingerprints everything under /assets/, so those can be cached hard
    // and never revalidated; the HTML shell that references them must not be.
    const hashed = url.pathname.startsWith('/assets/')
    const cacheControl =
      ext === '.html' || ext === ''
        ? 'no-cache'
        : hashed
          ? 'public, max-age=31536000, immutable'
          : `public, max-age=${STATIC_MAX_AGE}, must-revalidate`

    // Conditional request -> 304, so repeat loads cost headers instead of the whole file.
    const inm = req.headers['if-none-match']
    const ims = req.headers['if-modified-since']
    const matchesEtag = inm && inm.split(',').some((t) => t.trim() === etag)
    const notModifiedSince =
      !inm && ims && Date.parse(ims) >= Math.floor(stat.mtimeMs / 1000) * 1000
    if (matchesEtag || notModifiedSince) {
      res.writeHead(304, { etag, 'last-modified': lastModified, 'cache-control': cacheControl })
      res.end()
      return
    }

    const data = await fs.readFile(file)
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': data.length,
      'cache-control': cacheControl,
      etag,
      'last-modified': lastModified,
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(data)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Music UI: http://0.0.0.0:${PORT}  |  API proxied to ${API_TARGET}`)
})
