// Same-origin chunk-streamed download endpoint for the Vercel deployment.
//
// Upgraded in v3.0: streams `upstream.body` directly via `Readable.fromWeb` +
// `pipeline` so full-length 320kbps tracks (>4.5 MB) stream immediately with
// zero full-file memory buffering or serverless payload truncation.
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import app from '../jiosaavn-api/src/server.js'

const CDN_HOSTS = ['saavncdn.com', 'jiosaavn.com', 'akamaized.net', 'akamaihd.net']

function hostOK(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return CDN_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  } catch {
    return false
  }
}

function safeFilename(value) {
  return (
    String(value || 'song')
      .replace(/[\\/:*?"<>|\r\n]/g, '')
      .trim()
      .slice(0, 120) || 'song'
  )
}

function apiRequest(req, path) {
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers.host || process.env.VERCEL_URL || 'localhost'
  return new Request(`${protocol}://${host}${path}`, {
    headers: { accept: 'application/json' },
  })
}

async function resolveSong(req, id, quality) {
  if (!/^[A-Za-z0-9_-]+$/.test(id || '')) return null
  const response = await app.fetch(apiRequest(req, `/api/songs/${encodeURIComponent(id)}`))
  if (!response.ok) return null
  const payload = await response.json().catch(() => null)
  const data = payload?.data
  const song = Array.isArray(data) ? data[0] : data?.songs?.[0] || data?.song || data
  const urls = song?.downloadUrl || []
  const match = urls.find((item) => item.quality === quality) || urls.at(-1)
  return match?.url && hostOK(match.url) ? match.url : null
}

export default async function handler(req, res) {
  const reqOrigin = req.headers?.origin || '*'
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.setHeader('access-control-allow-origin', reqOrigin)
    res.setHeader('vary', 'Origin')
    res.setHeader('access-control-allow-methods', 'GET, HEAD, OPTIONS')
    res.setHeader('access-control-allow-headers', 'accept, content-type, range')
    res.end()
    return
  }

  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers.host || process.env.VERCEL_URL || 'localhost'
  const requestURL = new URL(req.url || '/', `${protocol}://${host}`)
  const songId = requestURL.searchParams.get('songId') || ''
  const quality = requestURL.searchParams.get('q') || '320kbps'
  let target = requestURL.searchParams.get('url') || ''

  try {
    const fresh = await resolveSong(req, songId, quality).catch(() => null)
    if (fresh) target = fresh
    if (!hostOK(target)) {
      res.statusCode = 400
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ success: false, message: 'No valid download URL was supplied.' }))
      return
    }

    const upstream = await fetch(target, {
      headers: {
        'user-agent': 'Mozilla/5.0',
        ...(req.headers?.range ? { range: req.headers.range } : {}),
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(55_000),
    })
    const contentType = (upstream.headers.get('content-type') || '').split(';')[0] || 'audio/mpeg'
    if ((!upstream.ok && upstream.status !== 206) || /json|text\/html/i.test(contentType)) {
      res.statusCode = 502
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ success: false, message: 'The audio CDN declined the download.' }))
      return
    }

    const extension = /mp4|m4a|aac/i.test(contentType) ? 'm4a' : 'mp3'
    const fileName = `${safeFilename(requestURL.searchParams.get('name'))}.${extension}`
    res.statusCode = upstream.status === 206 ? 206 : 200
    res.setHeader('content-type', contentType)
    res.setHeader('content-disposition', `attachment; filename="${fileName}"`)
    res.setHeader('cache-control', 'no-store')
    res.setHeader('access-control-allow-origin', reqOrigin)
    res.setHeader('vary', 'Origin')
    res.setHeader('access-control-expose-headers', 'content-disposition, content-length, content-range')
    const length = upstream.headers.get('content-length')
    if (length) res.setHeader('content-length', length)
    const contentRange = upstream.headers.get('content-range')
    if (contentRange) res.setHeader('content-range', contentRange)

    if (upstream.body && typeof upstream.body.getReader === 'function' && typeof res.write === 'function') {
      const reader = upstream.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (res.writableEnded || res.destroyed) {
            await reader.cancel().catch(() => {})
            return
          }
          const ok = res.write(Buffer.from(value))
          if (ok === false && typeof res.once === 'function') {
            await new Promise((resolve) => res.once('drain', resolve))
          }
        }
        if (!res.writableEnded) res.end()
      } finally {
        try {
          reader.releaseLock()
        } catch {
          /* ignore */
        }
      }
      return
    }

    res.end(Buffer.from(await upstream.arrayBuffer()))
  } catch {
    if (!res.headersSent) {
      res.statusCode = 502
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ success: false, message: 'Download proxy failed.' }))
    } else {
      try {
        res.end()
      } catch {
        /* client disconnected */
      }
    }
  }
}
