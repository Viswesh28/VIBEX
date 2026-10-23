/**
 * YouTube Music catalogue search + cross-catalogue studio audio resolution.
 *
 * Supports two compliant catalogue discovery paths:
 * 1. Official YouTube Data API v3 (`YOUTUBE_API_KEY` env var or `x-youtube-api-key`
 *    request header) using `youtube/v3/search` + `youtube/v3/videos`.
 * 2. Public YouTube Music catalogue search fallback when no API key is configured.
 *
 * Raw YouTube media streams are NEVER extracted or decrypted here. Instead,
 * non-long-form results are matched by `(title, artist, album, duration)` metadata
 * against JioSaavn's studio catalogue so matched songs play natively as pure
 * `<audio>` tracks just like JioSaavn, while unmatched YouTube-only uploads play
 * in YouTube's official IFrame Player.
 */

import {
  buildMatchQueries,
  cleanChannelArtist,
  matchSaavnTrack,
  parseIsoDuration,
  unescapeEntities,
} from './_lib/trackMatch.mjs'

const SEARCH_TIMEOUT = 6000
const ENRICH_BUDGET_MS = 3800
const ENRICH_CONCURRENCY = 6
const LONG_FORM_SEC = 20 * 60

const WEB_REMIX = {
  client: { clientName: 'WEB_REMIX', clientVersion: '1.20240701.00.00', hl: 'en', gl: 'US' },
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** The music-videos-and-songs filter the YouTube Music search box uses. */
const SONGS_PARAMS = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D'

async function postJson(url, body, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': UA,
        'accept-language': 'en-US,en;q=0.9',
        origin: 'https://music.youtube.com',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, status: res.status }
    return { ok: true, json: JSON.parse(text) }
  } catch (e) {
    return { ok: false, status: 0, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e) }
  } finally {
    clearTimeout(timer)
  }
}

async function getJson(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json) return { ok: false, status: res.status }
    return { ok: true, json }
  } catch (e) {
    return { ok: false, status: 0, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e) }
  } finally {
    clearTimeout(timer)
  }
}

/** Join the text of a YouTube "runs" array, ignoring separators it leaves behind. */
export function runsText(node) {
  if (!node) return ''
  const runs = node.runs || (node.simpleText ? [{ text: node.simpleText }] : [])
  return runs
    .map((r) => r.text || '')
    .join('')
    .replace(/\s*•\s*/g, ' • ')
    .trim()
}

/** Every `musicResponsiveListItemRenderer` in the tree, in order. */
export function listItemRenderers(node, out = [], depth = 0) {
  if (depth > 24 || node == null || out.length > 200) return out
  if (Array.isArray(node)) {
    for (const v of node) listItemRenderers(v, out, depth + 1)
    return out
  }
  if (typeof node === 'object') {
    if (node.musicResponsiveListItemRenderer) out.push(node.musicResponsiveListItemRenderer)
    for (const k of Object.keys(node)) listItemRenderers(node[k], out, depth + 1)
  }
  return out
}

/** Walk the response tree for the first shelf continuation token, if present. */
export function findContinuationToken(node, depth = 0) {
  if (depth > 24 || node == null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findContinuationToken(item, depth + 1)
      if (hit) return hit
    }
    return null
  }
  const direct =
    node?.nextContinuationData?.continuation ||
    node?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ||
    null
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  for (const key of Object.keys(node)) {
    const hit = findContinuationToken(node[key], depth + 1)
    if (hit) return hit
  }
  return null
}

/** "3:42" → 222. Tolerates "1:02:03" and junk. */
export function seconds(text) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(text || '').trim())
  if (!m) return 0
  return m[3] ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2]
}

function biggestThumb(thumbnails) {
  if (!Array.isArray(thumbnails) || !thumbnails.length) return null
  return thumbnails[thumbnails.length - 1]?.url || null
}

function bestSnippetThumb(thumbs) {
  if (!thumbs || typeof thumbs !== 'object') return null
  return (
    thumbs.maxres?.url ||
    thumbs.standard?.url ||
    thumbs.high?.url ||
    thumbs.medium?.url ||
    thumbs.default?.url ||
    null
  )
}

function isExplicitRenderer(renderer) {
  const badges = renderer?.badges || []
  return badges.some(
    (b) =>
      b?.musicInlineBadgeRenderer?.icon?.iconType === 'MUSIC_EXPLICIT_BADGE' ||
      /explicit/i.test(String(b?.musicInlineBadgeRenderer?.accessibilityData?.accessibilityData?.label || ''))
  )
}

/** Pull one renderer apart into the flat shape the client maps. */
export function toResult(renderer) {
  if (!renderer || typeof renderer !== 'object') return null
  const cols = renderer.flexColumns || []
  const title = runsText(cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text)
  const subtitleText = runsText(cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text)

  // The subtitle is "Artist • Album • 3:42"; the tail is the duration when it
  // parses, and the first segment is the artist.
  const parts = subtitleText.split('•').map((p) => p.trim()).filter(Boolean)
  const duration = seconds(parts[parts.length - 1])
  const artists = parts.filter((p) => p && !/^\d{1,2}:\d{2}(:\d{2})?$/.test(p))
  const album = artists.length > 1 ? artists[artists.length - 1] : null

  const videoId =
    renderer.playlistItemData?.videoId ||
    renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint?.videoId ||
    renderer.navigationEndpoint?.watchEndpoint?.videoId ||
    null

  const thumbnails =
    renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    renderer.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails ||
    []

  if (!videoId || !title) return null
  return {
    videoId,
    title,
    artists: artists.slice(0, -1).length ? artists.slice(0, -1) : artists,
    album: album && artists.length > 1 ? album : null,
    subtitle: subtitleText,
    duration,
    thumbnail: biggestThumb(thumbnails),
    explicit: isExplicitRenderer(renderer),
  }
}

/** Parse a full search payload into deduplicated items + optional continuation cursor. */
export function parseYtSearchResponse(json, limit = 20) {
  const seen = new Set()
  const results = []
  for (const renderer of listItemRenderers(json)) {
    const item = toResult(renderer)
    if (!item || seen.has(item.videoId)) continue
    seen.add(item.videoId)
    results.push(item)
    if (results.length >= limit) break
  }
  const nextPageToken = results.length ? findContinuationToken(json) : null
  return { results, nextPageToken }
}

/** Parse Official YouTube Data API v3 `search.list` + `videos.list` payloads. */
export function parseYtDataApiResponse(searchJson, videosJson = null, limit = 20) {
  const items = Array.isArray(searchJson?.items) ? searchJson.items : []
  const detailsById = new Map()
  for (const v of Array.isArray(videosJson?.items) ? videosJson.items : []) {
    if (v?.id) detailsById.set(String(v.id), v)
  }

  const seen = new Set()
  const results = []
  for (const entry of items) {
    const videoId = typeof entry?.id === 'string' ? entry.id : entry?.id?.videoId
    if (!videoId || seen.has(videoId)) continue
    const detail = detailsById.get(videoId)
    const snippet = detail?.snippet || entry?.snippet || {}
    const title = unescapeEntities(snippet.title || '').trim()
    if (!title) continue
    seen.add(videoId)

    const artist = cleanChannelArtist(snippet.channelTitle || '')
    const duration = parseIsoDuration(detail?.contentDetails?.duration)
    results.push({
      videoId,
      title,
      artists: artist ? [artist] : [],
      album: null,
      subtitle: artist,
      duration,
      thumbnail: bestSnippetThumb(snippet.thumbnails),
      explicit: false,
    })
    if (results.length >= limit) break
  }

  return {
    results,
    nextPageToken: searchJson?.nextPageToken || null,
  }
}

async function searchViaOfficialDataApi({ query, pageToken, limit, apiKey }) {
  const searchParams = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoCategoryId: '10',
    maxResults: String(Math.min(limit, 50)),
    key: apiKey,
  })
  if (query) searchParams.set('q', query)
  if (pageToken) searchParams.set('pageToken', pageToken)

  const searchRes = await getJson(
    `https://www.googleapis.com/youtube/v3/search?${searchParams.toString()}`,
    SEARCH_TIMEOUT
  )
  if (!searchRes.ok) return null

  const ids = (searchRes.json?.items || [])
    .map((it) => (typeof it?.id === 'string' ? it.id : it?.id?.videoId))
    .filter(Boolean)

  let videosJson = null
  if (ids.length) {
    const vidParams = new URLSearchParams({
      part: 'contentDetails,snippet',
      id: ids.join(','),
      key: apiKey,
    })
    const vidRes = await getJson(
      `https://www.googleapis.com/youtube/v3/videos?${vidParams.toString()}`,
      SEARCH_TIMEOUT
    )
    if (vidRes.ok) videosJson = vidRes.json
  }

  return parseYtDataApiResponse(searchRes.json, videosJson, limit)
}

let cachedSaavnAppPromise = null
function loadSaavnApp() {
  if (!cachedSaavnAppPromise) {
    cachedSaavnAppPromise = import('../jiosaavn-api/src/server.js')
      .then((m) => m.default)
      .catch(() => null)
  }
  return cachedSaavnAppPromise
}

async function defaultSaavnSearch(query, signal) {
  const path = `/api/search/songs?query=${encodeURIComponent(query)}&limit=8`
  if (process.env.API_TARGET) {
    const r = await fetch(`${process.env.API_TARGET}${path}`, {
      headers: { accept: 'application/json' },
      signal,
    })
    if (!r.ok) return []
    const payload = await r.json().catch(() => null)
    return Array.isArray(payload?.data?.results) ? payload.data.results : []
  }

  const app = await loadSaavnApp()
  if (!app) return []
  const r = await app.fetch(
    new Request(`https://vibex.internal${path}`, {
      headers: { accept: 'application/json' },
      signal,
    })
  )
  if (!r.ok) return []
  const payload = await r.json().catch(() => null)
  return Array.isArray(payload?.data?.results) ? payload.data.results : []
}

/**
 * Enrich YouTube catalog rows in parallel with matched JioSaavn studio audio
 * metadata + CDN URLs so tracks play natively as pure `<audio>` in the app.
 */
export async function enrichResultsWithSaavnAudio(
  results,
  { saavnSearchFn = defaultSaavnSearch, budgetMs = ENRICH_BUDGET_MS } = {}
) {
  if (!Array.isArray(results) || !results.length) return results
  const out = results.map((item) => ({ ...item }))
  const queryMemo = new Map()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), budgetMs)

  const cachedSearch = (q) => {
    const key = q.toLowerCase()
    if (!queryMemo.has(key)) {
      queryMemo.set(
        key,
        saavnSearchFn(q, ctl.signal).catch(() => [])
      )
    }
    return queryMemo.get(key)
  }

  let cursor = 0
  const worker = async () => {
    while (cursor < out.length && !ctl.signal.aborted) {
      const idx = cursor
      cursor += 1
      const item = out[idx]
      if (!item || (Number(item.duration) > 0 && Number(item.duration) >= LONG_FORM_SEC)) continue
      const queries = buildMatchQueries(item)
      for (const q of queries) {
        if (ctl.signal.aborted) break
        const candidates = await cachedSearch(q)
        const hit = matchSaavnTrack(item, candidates)
        if (hit?.song) {
          out[idx] = {
            ...item,
            matchedAudio: {
              provider: 'jiosaavn',
              songId: hit.song.id,
              album: hit.song.album || null,
              artists: hit.song.artists || null,
              duration: Number(hit.song.duration) || 0,
              image: Array.isArray(hit.song.image) ? hit.song.image : [],
              downloadUrl: hit.song.downloadUrl,
            },
          }
          break
        }
      }
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(ENRICH_CONCURRENCY, out.length) }, () => worker())
    )
  } finally {
    clearTimeout(timer)
  }
  return out
}

export default async function handler(req, res) {
  const q = req.query || {}
  const query = String(q.query || '').slice(0, 160)
  const pageToken = typeof q.pageToken === 'string' ? q.pageToken.trim().slice(0, 512) : ''
  const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 40)
  const shouldEnrich = q.enrich !== '0'
  const headerKey = String(req.headers?.['x-youtube-api-key'] || '').trim()
  const apiKey = headerKey || String(process.env.YOUTUBE_API_KEY || '').trim()

  if (!query && !pageToken) {
    res.status(400).json({ success: false, code: 'bad_request', message: 'A query is required.' })
    return
  }

  let parsed = null
  let providerMode = 'ytmusic-catalog'

  // Prefer Official YouTube Data API v3 when a key is supplied; transparently
  // fall back to public catalog search if unconfigured or quota-limited.
  if (apiKey) {
    parsed = await searchViaOfficialDataApi({ query, pageToken, limit, apiKey })
    if (parsed) providerMode = 'youtube-data-v3'
  }

  if (!parsed) {
    const endpoint = pageToken
      ? `https://music.youtube.com/youtubei/v1/search?continuation=${encodeURIComponent(pageToken)}&ctoken=${encodeURIComponent(pageToken)}&prettyPrint=false`
      : 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false'

    const body = pageToken
      ? { context: WEB_REMIX }
      : { context: WEB_REMIX, query, params: SONGS_PARAMS }

    const r = await postJson(endpoint, body, SEARCH_TIMEOUT)

    if (!r.ok) {
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({
        success: false,
        code: r.status === 429 ? 'blocked' : 'upstream_error',
        message: 'YouTube Music search is unavailable right now.',
        detail: r.error || `http_${r.status}`,
      })
      return
    }

    parsed = parseYtSearchResponse(r.json, limit)
  }

  const results = shouldEnrich
    ? await enrichResultsWithSaavnAudio(parsed.results)
    : parsed.results

  res.setHeader(
    'Cache-Control',
    headerKey ? 'private, max-age=120' : 'public, s-maxage=300, stale-while-revalidate=900'
  )
  res.status(200).json({
    success: true,
    data: {
      source: 'ytmusic',
      providerMode,
      total: results.length,
      results,
      nextPageToken: parsed.nextPageToken,
    },
  })
}
