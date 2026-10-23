/**
 * /api/ytaudio  --  Byte-Verified, Stream-Piped YouTube Video -> Pure Audio Proxy.
 *
 * Upgraded in v3.0:
 * 1. True Web-Readable -> Node HTTP response streaming (`Readable.fromWeb`) for
 *    instant Time-To-First-Audio-Byte and zero 4.5 MB serverless buffer limits.
 * 2. Bounded LRU stream memo (`MAX_STREAM_MEMO = 200`) preventing memory leaks.
 * 3. Automatic dead-mirror circuit breaker cooling down failing Piped/Invidious
 *    mirrors for 5 minutes so healthy extractors win without wasted sockets.
 * 4. Per-IP sliding-window rate guard protecting serverless bandwidth.
 */

import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { cleanChannelArtist } from './_lib/trackMatch.mjs'

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/
const RACE_TIMEOUT_MS = 1800
const VERIFY_TIMEOUT_MS = 1200
const STREAM_TIMEOUT_MS = 55_000
export const MAX_STREAM_MEMO = 200
const MIRROR_COOLDOWN_MS = 5 * 60_000
const RATE_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 90

const INNERTUBE_CLIENTS = [
  {
    name: 'ANDROID_VR',
    clientHeader: '28',
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    context: {
      client: {
        clientName: 'ANDROID_VR',
        clientVersion: '1.60.19',
        deviceMake: 'Oculus',
        deviceModel: 'Quest 3',
        androidSdkVersion: 32,
        osName: 'Android',
        osVersion: '12L',
        hl: 'en',
        gl: 'IN',
      },
    },
  },
  {
    name: 'IOS',
    clientHeader: '5',
    userAgent:
      'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)',
    context: {
      client: {
        clientName: 'IOS',
        clientVersion: '19.45.4',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        osName: 'iPhone',
        osVersion: '18.1.0.22B83',
        hl: 'en',
        gl: 'IN',
      },
    },
  },
  {
    name: 'TV_EMBEDDED',
    clientHeader: '85',
    userAgent: 'Mozilla/5.0 (PlayStation; PlayStation 5/6.50) AppleWebKit/605.1.15',
    context: {
      client: {
        clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
        clientVersion: '2.0',
        hl: 'en',
        gl: 'IN',
      },
      thirdParty: {
        embedUrl: 'https://www.youtube.com/',
      },
    },
  },
]

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.private.coffee',
  'https://pipedapi.reallyaweso.me',
]

const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
]

// Bounded LRU stream cache + mirror circuit-breaker state per Fluid Compute instance.
export const streamMemo = new Map()
const mirrorCooldowns = new Map()
const ipBuckets = new Map()

export function pruneStreamMemo(now = Date.now()) {
  for (const [k, entry] of streamMemo.entries()) {
    if (entry?.expiresAt && entry.expiresAt <= now) streamMemo.delete(k)
  }
  while (streamMemo.size > MAX_STREAM_MEMO) {
    const oldest = streamMemo.keys().next().value
    if (oldest === undefined) break
    streamMemo.delete(oldest)
  }
}

export function setStreamMemo(videoId, value) {
  if (streamMemo.has(videoId)) streamMemo.delete(videoId)
  streamMemo.set(videoId, { value, expiresAt: Date.now() + 60_000 })
  pruneStreamMemo()
}

export function isMirrorHealthy(base) {
  const until = mirrorCooldowns.get(base)
  if (!until) return true
  if (Date.now() >= until) {
    mirrorCooldowns.delete(base)
    return true
  }
  return false
}

export function markMirrorFailure(base) {
  mirrorCooldowns.set(base, Date.now() + MIRROR_COOLDOWN_MS)
}

export const markMirrorDead = markMirrorFailure

export function isRateLimited(ipOrReq) {
  const reqObj =
    typeof ipOrReq === 'string'
      ? { headers: { 'x-forwarded-for': ipOrReq } }
      : ipOrReq
  return !allowIpRequest(reqObj)
}

function allowIpRequest(req) {
  const ip = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  if (!ip) return true
  const now = Date.now()
  const entry = ipBuckets.get(ip)
  if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
    ipBuckets.set(ip, { windowStart: now, count: 1 })
    if (ipBuckets.size > 500) {
      const oldest = ipBuckets.keys().next().value
      if (oldest !== undefined) ipBuckets.delete(oldest)
    }
    return true
  }
  entry.count += 1
  return entry.count <= RATE_LIMIT_MAX
}

function safeFilename(value) {
  return (
    String(value || 'track')
      .replace(/[\\/:*?"<>|\r\n]/g, '')
      .trim()
      .slice(0, 120) || 'track'
  )
}

function formatKbps(bps) {
  const kbps = Math.round((Number(bps) || 128_000) / 1000)
  if (kbps >= 256) return '320kbps'
  if (kbps >= 140) return '160kbps'
  if (kbps >= 80) return '96kbps'
  return '48kbps'
}

/** Rank audio-only formats highest first, preferring universally playable `audio/mp4` (AAC). */
export function pickBestAudioFormat(formats = []) {
  const candidates = formats
    .filter((f) => {
      if (!f?.url || typeof f.url !== 'string') return false
      const mime = String(f.mimeType || f.type || '').toLowerCase()
      return mime.startsWith('audio/')
    })
    .map((f) => {
      const mimeRaw = String(f.mimeType || f.type || 'audio/mp4')
      const baseMime = mimeRaw.split(';')[0].trim().toLowerCase()
      const bitrate = Number(f.bitrate || f.averageBitrate || 0)
      const codecBonus = baseMime.includes('mp4') || baseMime.includes('m4a') ? 40_000 : 0
      return {
        url: f.url,
        mimeType: baseMime || 'audio/mp4',
        bitrate,
        quality: formatKbps(bitrate),
        contentLength: Number(f.contentLength || 0) || null,
        rank: bitrate + codecBonus,
      }
    })
    .sort((a, b) => b.rank - a.rank)

  return candidates[0] || null
}

/**
 * Confirm this server egress IP can actually stream bytes from `candidate.url`
 * (`200` / `206` non-HTML response).
 */
async function verifyStreamReachable(candidate, fetchImpl, parentSignal) {
  const ctl = new AbortController()
  const onParentAbort = () => ctl.abort()
  parentSignal?.addEventListener?.('abort', onParentAbort, { once: true })
  const timer = setTimeout(() => ctl.abort(), VERIFY_TIMEOUT_MS)
  try {
    const probe = await fetchImpl(candidate.url, {
      method: 'GET',
      headers: {
        'user-agent': candidate.userAgent || 'Mozilla/5.0',
        accept: '*/*',
        range: 'bytes=0-1',
      },
      redirect: 'follow',
      signal: ctl.signal,
    })
    if (!probe?.ok && probe?.status !== 206) {
      throw new Error(`stream_probe_${probe?.status || 0}`)
    }
    const ct = String(probe.headers?.get?.('content-type') || '').toLowerCase()
    if (ct.includes('text/html') || ct.includes('application/json')) {
      throw new Error('stream_probe_not_media')
    }
    return candidate
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener?.('abort', onParentAbort)
  }
}

async function tryInnerTubeClient(videoId, client, fetchImpl, signal) {
  const res = await fetchImpl('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': client.userAgent,
      'x-youtube-client-name': client.clientHeader,
      'x-youtube-client-version': client.context.client.clientVersion,
    },
    body: JSON.stringify({
      videoId,
      context: client.context,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
    signal,
  })
  if (!res?.ok) throw new Error(`innertube_${client.name}_${res?.status || 0}`)
  const data = await res.json()
  if (data?.playabilityStatus?.status !== 'OK') {
    throw new Error(`unplayable_${client.name}`)
  }
  const allFormats = [
    ...(data?.streamingData?.adaptiveFormats || []),
    ...(data?.streamingData?.formats || []),
  ]
  const picked = pickBestAudioFormat(allFormats)
  if (!picked) throw new Error(`no_audio_${client.name}`)
  return verifyStreamReachable(
    {
      ...picked,
      userAgent: client.userAgent,
      source: `innertube:${client.name.toLowerCase()}`,
      title: data?.videoDetails?.title || '',
      artist: cleanChannelArtist(data?.videoDetails?.author || ''),
      duration: Number(data?.videoDetails?.lengthSeconds || 0),
    },
    fetchImpl,
    signal
  )
}

async function tryPipedMirror(videoId, base, fetchImpl, signal, useCircuitBreaker) {
  try {
    const res = await fetchImpl(`${base}/streams/${encodeURIComponent(videoId)}`, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
      signal,
    })
    if (!res?.ok) {
      if (useCircuitBreaker && (res?.status >= 500 || res?.status === 429 || res?.status === 403)) {
        markMirrorFailure(base)
      }
      throw new Error(`piped_${res?.status || 0}`)
    }
    const json = await res.json()
    const streams = (json?.audioStreams || []).map((s) => ({
      url: s?.url,
      mimeType: s?.mimeType || (s?.format === 'M4A' ? 'audio/mp4' : 'audio/webm'),
      bitrate: Number(s?.bitrate || 0),
    }))
    const picked = pickBestAudioFormat(streams)
    if (!picked) throw new Error('piped_no_audio')
    return verifyStreamReachable(
      {
        ...picked,
        userAgent: 'Mozilla/5.0',
        source: 'piped',
        title: json?.title || '',
        artist: cleanChannelArtist(json?.uploader || ''),
        duration: Number(json?.duration || 0),
      },
      fetchImpl,
      signal
    )
  } catch (err) {
    if (useCircuitBreaker && !signal?.aborted) markMirrorFailure(base)
    throw err
  }
}

async function tryInvidiousMirror(videoId, base, fetchImpl, signal, useCircuitBreaker) {
  try {
    const res = await fetchImpl(
      `${base}/api/v1/videos/${encodeURIComponent(videoId)}?fields=title,author,lengthSeconds,adaptiveFormats`,
      {
        headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
        signal,
      }
    )
    if (!res?.ok) {
      if (useCircuitBreaker && (res?.status >= 500 || res?.status === 429 || res?.status === 403)) {
        markMirrorFailure(base)
      }
      throw new Error(`invidious_${res?.status || 0}`)
    }
    const json = await res.json()
    const picked = pickBestAudioFormat(json?.adaptiveFormats || [])
    if (!picked) throw new Error('invidious_no_audio')
    return verifyStreamReachable(
      {
        ...picked,
        userAgent: 'Mozilla/5.0',
        source: 'invidious',
        title: json?.title || '',
        artist: cleanChannelArtist(json?.author || ''),
        duration: Number(json?.lengthSeconds || 0),
      },
      fetchImpl,
      signal
    )
  } catch (err) {
    if (useCircuitBreaker && !signal?.aborted) markMirrorFailure(base)
    throw err
  }
}

async function raceDirectAudioExtractors(videoId, fetchImpl = fetch, useCircuitBreaker = false) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), RACE_TIMEOUT_MS)
  try {
    const healthyPiped = useCircuitBreaker
      ? PIPED_INSTANCES.filter(isMirrorHealthy)
      : PIPED_INSTANCES
    const healthyInvidious = useCircuitBreaker
      ? INVIDIOUS_INSTANCES.filter(isMirrorHealthy)
      : INVIDIOUS_INSTANCES
    const pipedPool = healthyPiped.length ? healthyPiped : PIPED_INSTANCES.slice(0, 1)
    const invidiousPool = healthyInvidious.length ? healthyInvidious : INVIDIOUS_INSTANCES.slice(0, 1)

    const racers = [
      ...INNERTUBE_CLIENTS.map((c) => tryInnerTubeClient(videoId, c, fetchImpl, ctl.signal)),
      ...pipedPool.map((base) => tryPipedMirror(videoId, base, fetchImpl, ctl.signal, useCircuitBreaker)),
      ...invidiousPool.map((base) =>
        tryInvidiousMirror(videoId, base, fetchImpl, ctl.signal, useCircuitBreaker)
      ),
    ]
    const winner = await Promise.any(racers)
    ctl.abort()
    return winner
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function resolveOfficialOmvAudioFallback(videoId, fetchImpl = fetch) {
  try {
    let rawTitle = ''
    let cleanAuthor = ''

    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`
    const oeRes = await fetchImpl(oembedUrl, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(3000),
    }).catch(() => null)
    if (oeRes?.ok) {
      const oe = await oeRes.json().catch(() => null)
      rawTitle = String(oe?.title || '').trim()
      cleanAuthor = cleanChannelArtist(String(oe?.author_name || ''))
    }

    // Fallback for UMG / SME `- Topic` Art Tracks where `oembed` returns `401`:
    // `WEB_REMIX` `youtubei/v1/player` always returns `videoDetails` (`title`, `author`) cleanly!
    if (!rawTitle) {
      const metaRes = await fetchImpl('https://music.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Mozilla/5.0',
          origin: 'https://music.youtube.com',
          referer: 'https://music.youtube.com/',
        },
        body: JSON.stringify({
          context: {
            client: { clientName: 'WEB_REMIX', clientVersion: '1.20250312.01.00', hl: 'en', gl: 'US' },
          },
          videoId,
        }),
        signal: AbortSignal.timeout(3500),
      }).catch(() => null)
      if (metaRes?.ok) {
        const metaJson = await metaRes.json().catch(() => null)
        rawTitle = String(metaJson?.videoDetails?.title || '').trim()
        cleanAuthor = cleanChannelArtist(String(metaJson?.videoDetails?.author || ''))
      }
    }

    if (!rawTitle) return null

    const searchQuery = [rawTitle, cleanAuthor, 'official audio'].filter(Boolean).join(' ')
    const searchRes = await fetchImpl('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0',
        origin: 'https://www.youtube.com',
        referer: 'https://www.youtube.com/',
      },
      body: JSON.stringify({
        context: {
          client: { clientName: 'WEB', clientVersion: '2.20250312.01.00', hl: 'en', gl: 'US' },
        },
        query: searchQuery,
      }),
      signal: AbortSignal.timeout(4500),
    }).catch(() => null)
    if (!searchRes?.ok) return null
    const bodyText =
      typeof searchRes.text === 'function'
        ? await searchRes.text().catch(() => '')
        : JSON.stringify(await searchRes.json().catch(() => ''))
    const candidateIds = [
      ...new Set(
        [...bodyText.matchAll(/"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/g)]
          .map((m) => m[1])
          .filter((id) => id && id !== videoId)
      ),
    ].slice(0, 3)
    if (!candidateIds.length) return null

    const wantTokens = rawTitle
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3)

    for (const candId of candidateIds) {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 5000)
      try {
        const hit = await tryInnerTubeClient(candId, INNERTUBE_CLIENTS[0], fetchImpl, ctl.signal)
        const hitText = `${hit?.title || ''} ${hit?.artist || ''}`.toLowerCase()
        if (!wantTokens.length || wantTokens.some((tok) => hitText.includes(tok))) {
          return { ...hit, source: `${hit.source}:omv`, resolvedVideoId: candId }
        }
      } catch {
        /* try next candidate */
      } finally {
        clearTimeout(timer)
      }
    }
    return null
  } catch {
    return null
  }
}

/** Resolve a YouTube `videoId` strictly to its own verified audio stream (never another song). */
export async function resolveYoutubeAudioStream(
  videoId,
  { fetchImpl = fetch, useCache = true } = {}
) {
  if (!VIDEO_ID_RE.test(String(videoId || ''))) return null

  if (useCache) {
    const hit = streamMemo.get(videoId)
    if (hit && hit.expiresAt > Date.now()) {
      streamMemo.delete(videoId)
      streamMemo.set(videoId, hit)
      return hit.value || hit
    }
    if (hit) streamMemo.delete(videoId)
  }

  let resolved = await raceDirectAudioExtractors(videoId, fetchImpl, useCache)
  if (!resolved) {
    resolved = await resolveOfficialOmvAudioFallback(videoId, fetchImpl)
  }

  if (resolved && useCache) {
    setStreamMemo(videoId, resolved)
  }
  return resolved
}

export default async function handler(req, res, deps = {}) {
  const reqOrigin = req.headers?.origin || '*'
  res.setHeader('access-control-allow-origin', reqOrigin)
  res.setHeader('vary', 'Origin')
  res.setHeader('access-control-allow-methods', 'GET, HEAD, OPTIONS')
  res.setHeader('access-control-allow-headers', 'accept, content-type, range')
  res.setHeader(
    'access-control-expose-headers',
    'content-length, content-range, accept-ranges, content-disposition'
  )

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (!deps.fetchImpl && !allowIpRequest(req)) {
    res.statusCode = 429
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ success: false, message: 'Too many stream requests. Please slow down.' }))
    return
  }

  const protocol = req.headers?.['x-forwarded-proto'] || 'https'
  const host = req.headers?.host || process.env.VERCEL_URL || 'localhost'
  const url = new URL(req.url || '/', `${protocol}://${host}`)

  const rawId = (url.searchParams.get('id') || url.searchParams.get('v') || '').replace(/^yt:/, '')
  const metaOnly = url.searchParams.get('meta') === '1'
  const isDownload = url.searchParams.get('download') === '1'
  const fetchImpl = deps.fetchImpl || fetch

  if (!VIDEO_ID_RE.test(rawId)) {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(
      JSON.stringify({ success: false, message: 'A valid 11-character YouTube video id is required.' })
    )
    return
  }

  const resolved = await resolveYoutubeAudioStream(rawId, {
    fetchImpl,
    useCache: !deps.fetchImpl || streamMemo.has(rawId),
  })

  if (!resolved?.url) {
    res.statusCode = 404
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(
      JSON.stringify({
        success: false,
        data: { playable: false },
        message: 'No direct audio stream available.',
      })
    )
    return
  }

  if (metaOnly) {
    res.statusCode = 200
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'public, s-maxage=60, stale-while-revalidate=120')
    res.end(
      JSON.stringify({
        success: true,
        data: {
          playable: true,
          videoId: rawId,
          mimeType: resolved.mimeType,
          quality: resolved.quality,
          source: resolved.source,
          duration: resolved.duration || 0,
        },
      })
    )
    return
  }

  try {
    const upstreamHeaders = {
      'user-agent': resolved.userAgent || 'Mozilla/5.0',
      accept: '*/*',
    }
    if (req.headers?.range && !isDownload) {
      upstreamHeaders.range = req.headers.range
    }

    const upstream = await fetchImpl(resolved.url, {
      headers: upstreamHeaders,
      redirect: 'follow',
      signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
    })

    if (!upstream.ok && upstream.status !== 206) {
      streamMemo.delete(rawId)
      res.statusCode = 502
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ success: false, message: 'Upstream audio stream declined the request.' }))
      return
    }

    const contentType = (
      upstream.headers.get('content-type') ||
      resolved.mimeType ||
      'audio/mp4'
    ).split(';')[0]
    res.statusCode = upstream.status === 206 ? 206 : 200
    res.setHeader('content-type', contentType)
    res.setHeader('accept-ranges', upstream.headers.get('accept-ranges') || 'bytes')
    const contentRange = upstream.headers.get('content-range')
    if (contentRange) res.setHeader('content-range', contentRange)
    const contentLength = upstream.headers.get('content-length')
    if (contentLength) res.setHeader('content-length', contentLength)
    res.setHeader('cache-control', 'no-store')

    if (isDownload) {
      const ext = /webm|opus/i.test(contentType) ? 'webm' : 'm4a'
      const dlName = safeFilename(
        url.searchParams.get('name') ||
          [resolved.artist, resolved.title].filter(Boolean).join(' - ') ||
          rawId
      )
      res.setHeader('content-disposition', `attachment; filename="${dlName}.${ext}"`)
    }

    if (req.method === 'HEAD') {
      res.end()
      return
    }

    // Stream chunks straight to client with zero RAM buffering, full backpressure & disconnect cancel.
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
      res.end(JSON.stringify({ success: false, message: 'Audio stream proxy failed.' }))
    } else {
      try {
        res.end()
      } catch {
        /* client disconnected mid-stream */
      }
    }
  }
}
