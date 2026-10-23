/**
 * /api/ytaudio  --  YouTube Video -> Pure Audio Track Stream Resolver & Proxy.
 *
 * Converts any YouTube video ID (`11` chars) into a pure audio stream (`audio/mp4`
 * AAC or `audio/webm` Opus) playable directly inside HTML5 `<audio>` elements
 * with full HTTP `Range` (`206 Partial Content`) seeking and optional `.m4a`
 * attachment download (`?download=1`), racing multiple independent audio
 * extractors concurrently so unmatched videos start playing in ~300ms:
 *
 *   1. Parallel race (`Promise.any`) across:
 *      - Direct YouTube InnerTube `player` audio-only adaptive formats
 *        (`ANDROID_VR`, `IOS`, `TVHTML5_SIMPLY_EMBEDDED_PLAYER`)
 *      - Public Piped & Invidious audio-stream mirrors
 *   2. YouTube `oEmbed` (`title` + `author_name`) -> bundled JioSaavn `320kbps`
 *      studio audio stream fallback.
 */

import saavnApp from '../jiosaavn-api/src/server.js'
import {
  buildMatchQueries,
  cleanChannelArtist,
  matchSaavnTrack,
  unescapeEntities,
} from './_lib/trackMatch.mjs'

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/
const RACE_TIMEOUT_MS = 4500
const STREAM_TIMEOUT_MS = 55_000

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
  'https://pipedapi.smnz.de',
]

const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.jing.rocks',
]

// Short in-memory stream cache per warm Lambda instance (90s TTL).
const streamMemo = new Map()

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
  return {
    ...picked,
    userAgent: client.userAgent,
    source: `innertube:${client.name.toLowerCase()}`,
    title: data?.videoDetails?.title || '',
    artist: cleanChannelArtist(data?.videoDetails?.author || ''),
    duration: Number(data?.videoDetails?.lengthSeconds || 0),
  }
}

async function tryPipedMirror(videoId, base, fetchImpl, signal) {
  const res = await fetchImpl(`${base}/streams/${encodeURIComponent(videoId)}`, {
    headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
    signal,
  })
  if (!res?.ok) throw new Error(`piped_${res?.status || 0}`)
  const json = await res.json()
  const streams = (json?.audioStreams || []).map((s) => ({
    url: s?.url,
    mimeType: s?.mimeType || (s?.format === 'M4A' ? 'audio/mp4' : 'audio/webm'),
    bitrate: Number(s?.bitrate || 0),
  }))
  const picked = pickBestAudioFormat(streams)
  if (!picked) throw new Error('piped_no_audio')
  return {
    ...picked,
    userAgent: 'Mozilla/5.0',
    source: 'piped',
    title: json?.title || '',
    artist: cleanChannelArtist(json?.uploader || ''),
    duration: Number(json?.duration || 0),
  }
}

async function tryInvidiousMirror(videoId, base, fetchImpl, signal) {
  const res = await fetchImpl(
    `${base}/api/v1/videos/${encodeURIComponent(videoId)}?fields=title,author,lengthSeconds,adaptiveFormats`,
    {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
      signal,
    }
  )
  if (!res?.ok) throw new Error(`invidious_${res?.status || 0}`)
  const json = await res.json()
  const picked = pickBestAudioFormat(json?.adaptiveFormats || [])
  if (!picked) throw new Error('invidious_no_audio')
  return {
    ...picked,
    userAgent: 'Mozilla/5.0',
    source: 'invidious',
    title: json?.title || '',
    artist: cleanChannelArtist(json?.author || ''),
    duration: Number(json?.lengthSeconds || 0),
  }
}

async function raceDirectAudioExtractors(videoId, fetchImpl = fetch) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), RACE_TIMEOUT_MS)
  try {
    const racers = [
      ...INNERTUBE_CLIENTS.map((c) => tryInnerTubeClient(videoId, c, fetchImpl, ctl.signal)),
      ...PIPED_INSTANCES.map((base) => tryPipedMirror(videoId, base, fetchImpl, ctl.signal)),
      ...INVIDIOUS_INSTANCES.map((base) => tryInvidiousMirror(videoId, base, fetchImpl, ctl.signal)),
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

async function fetchOembedMeta(videoId, fetchImpl = fetch) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`
    )}&format=json`
    const res = await fetchImpl(oembedUrl, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(3000),
    })
    if (!res?.ok) return null
    const json = await res.json().catch(() => null)
    if (!json?.title) return null
    return {
      title: unescapeEntities(json.title),
      artist: cleanChannelArtist(json.author_name || ''),
    }
  } catch {
    return null
  }
}

async function resolveViaSaavnCatalog(
  videoId,
  { titleHint = '', artistHint = '', fetchImpl = fetch, saavnSearchFn = null } = {}
) {
  let title = String(titleHint || '').trim()
  let artist = String(artistHint || '').trim()

  if (!title) {
    const meta = await fetchOembedMeta(videoId, fetchImpl)
    if (meta) {
      title = meta.title
      artist = artist || meta.artist
    }
  }
  if (!title) return null

  const search =
    typeof saavnSearchFn === 'function'
      ? saavnSearchFn
      : async (q) => {
          if (!saavnApp?.fetch) return []
          const r = await saavnApp.fetch(
            new Request(`https://vibex.internal/api/search/songs?query=${encodeURIComponent(q)}&limit=10`, {
              headers: { accept: 'application/json' },
            })
          )
          if (!r.ok) return []
          const body = await r.json().catch(() => null)
          return Array.isArray(body?.data?.results) ? body.data.results : []
        }

  const probeTrack = {
    videoId,
    title,
    artists: artist ? [artist] : [],
    duration: 0,
  }
  const queries = buildMatchQueries(probeTrack)
  for (const q of queries) {
    const candidates = await search(q).catch(() => [])
    const hit =
      matchSaavnTrack(probeTrack, candidates) ||
      matchSaavnTrack(probeTrack, candidates, { allowVideoToTrack: true })
    if (hit?.song?.downloadUrl?.length) {
      const best = hit.song.downloadUrl.at(-1)
      if (best?.url) {
        return {
          url: best.url,
          mimeType: 'audio/mp4',
          bitrate: 320_000,
          quality: best.quality || '320kbps',
          userAgent: 'Mozilla/5.0',
          source: 'jiosaavn',
          title: hit.song.name || title,
          artist: artist,
          duration: Number(hit.song.duration || 0),
        }
      }
    }
  }
  return null
}

/** Resolve any YouTube `videoId` to an audio-only stream descriptor. */
export async function resolveYoutubeAudioStream(
  videoId,
  { titleHint = '', artistHint = '', fetchImpl = fetch, saavnSearchFn = null, useCache = true } = {}
) {
  if (!VIDEO_ID_RE.test(String(videoId || ''))) return null

  if (useCache) {
    const hit = streamMemo.get(videoId)
    if (hit && hit.expiresAt > Date.now()) return hit.value
  }

  const resolved =
    (await raceDirectAudioExtractors(videoId, fetchImpl)) ||
    (await resolveViaSaavnCatalog(videoId, { titleHint, artistHint, fetchImpl, saavnSearchFn }))

  if (resolved && useCache) {
    streamMemo.set(videoId, { value: resolved, expiresAt: Date.now() + 90_000 })
  }
  return resolved
}

export default async function handler(req, res, deps = {}) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET, HEAD, OPTIONS')
  res.setHeader('access-control-allow-headers', 'accept, content-type, range')
  res.setHeader('access-control-expose-headers', 'content-length, content-range, accept-ranges, content-disposition')

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  const protocol = req.headers?.['x-forwarded-proto'] || 'https'
  const host = req.headers?.host || process.env.VERCEL_URL || 'localhost'
  const url = new URL(req.url || '/', `${protocol}://${host}`)

  const rawId = (url.searchParams.get('id') || url.searchParams.get('v') || '').replace(/^yt:/, '')
  const metaOnly = url.searchParams.get('meta') === '1'
  const isDownload = url.searchParams.get('download') === '1'
  const titleHint = url.searchParams.get('title') || ''
  const artistHint = url.searchParams.get('artist') || ''
  const fetchImpl = deps.fetchImpl || fetch

  if (!VIDEO_ID_RE.test(rawId)) {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ success: false, message: 'A valid 11-character YouTube video id is required.' }))
    return
  }

  const resolved = await resolveYoutubeAudioStream(rawId, {
    titleHint,
    artistHint,
    fetchImpl,
    saavnSearchFn: deps.saavnSearchFn || null,
    useCache: !deps.fetchImpl,
  })

  if (!resolved?.url) {
    res.statusCode = 404
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify({ success: false, data: { playable: false }, message: 'No direct audio stream available.' }))
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

    const contentType = (upstream.headers.get('content-type') || resolved.mimeType || 'audio/mp4').split(';')[0]
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

    res.end(Buffer.from(await upstream.arrayBuffer()))
  } catch {
    if (!res.headersSent) {
      res.statusCode = 502
      res.setHeader('content-type', 'application/json; charset=utf-8')
    }
    res.end(JSON.stringify({ success: false, message: 'Audio stream proxy failed.' }))
  }
}
