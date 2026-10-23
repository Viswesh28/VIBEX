/**
 * YouTube Music catalogue search — the other source a listener can pick.
 *
 * Only the *catalogue* lives here. Search is the part YouTube still serves to
 * this deployment: it resolves ids, metadata and pagination continuations from
 * a datacenter IP without a session, which is what a catalogue adapter needs.
 *
 * Streams are deliberately not attempted here. The player endpoint answers
 * `LOGIN_REQUIRED` from this sort of address (measured, see docs/adr/0001),
 * and InnerTube is undocumented and unapproved for third-party audio streaming.
 * `src/lib/sources.js` and `src/lib/providers.js` map each result onto the
 * shared domain model and route playback strictly through YouTube's official
 * embed player.
 */

const SEARCH_TIMEOUT = 6000

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

export default async function handler(req, res) {
  const q = req.query || {}
  const query = String(q.query || '').slice(0, 160)
  const pageToken = typeof q.pageToken === 'string' ? q.pageToken.trim().slice(0, 512) : ''
  const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 40)

  if (!query && !pageToken) {
    res.status(400).json({ success: false, code: 'bad_request', message: 'A query is required.' })
    return
  }

  const endpoint = pageToken
    ? `https://music.youtube.com/youtubei/v1/search?continuation=${encodeURIComponent(pageToken)}&ctoken=${encodeURIComponent(pageToken)}&prettyPrint=false`
    : 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false'

  const body = pageToken
    ? { context: WEB_REMIX }
    : { context: WEB_REMIX, query, params: SONGS_PARAMS }

  const r = await postJson(endpoint, body, SEARCH_TIMEOUT)

  if (!r.ok) {
    // A search that cannot run is a typed answer, never a 500.
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      success: false,
      code: r.status === 429 ? 'blocked' : 'upstream_error',
      message: 'YouTube Music search is unavailable right now.',
      detail: r.error || `http_${r.status}`,
    })
    return
  }

  const { results, nextPageToken } = parseYtSearchResponse(r.json, limit)

  // Search results are stable for a given query; a short edge cache keeps the
  // picker from re-asking YouTube on every keystroke.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')
  res.status(200).json({
    success: true,
    data: { source: 'ytmusic', total: results.length, results, nextPageToken },
  })
}
