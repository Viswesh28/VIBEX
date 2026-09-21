// Gateway: serves this folder's static files + proxies /api/* to the local JioSaavn API.
// Run: PORT=8000 API_TARGET=http://127.0.0.1:3001 node server.mjs
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8000)
const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:3001'

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

    // --- Proxy API to JioSaavn backend ---
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const target = API_TARGET + url.pathname + url.search
      try {
        const r = await fetch(target, { headers: { accept: 'application/json' } })
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
      const songUrlFromApi = async () => {
        if (!/^[A-Za-z0-9_-]+$/.test(songId)) return null
        const r = await fetch(`${API_TARGET}/api/songs/${songId}`, { headers: { accept: 'application/json' } })
        if (!r.ok) return null
        const j = await r.json().catch(() => null)
        const d = j && j.data
        const s = Array.isArray(d) ? d[0] : (d && d.songs && d.songs[0]) || (d && d.song) || d
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
          'cache-control': 'no-store',
        }
        const clen = r.headers.get('content-length')
        if (clen) headers['content-length'] = clen
        res.writeHead(200, headers)
        const reader = r.body.getReader()
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

    // --- Static files ---
    const p = url.pathname === '/' ? '/index.html' : url.pathname
    const file = path.normalize(path.join(__dirname, decodeURIComponent(p)))
    if (!file.startsWith(__dirname)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    const data = await fs.readFile(file)
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(data)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Music UI: http://0.0.0.0:${PORT}  |  API proxied to ${API_TARGET}`)
})
