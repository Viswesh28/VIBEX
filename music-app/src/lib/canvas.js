/**
 * Canvas video — the short looping clip some players show behind the artwork.
 *
 * There is no canvas data in the JioSaavn catalogue, so this is a **cross-
 * source** feature: the audio stays on JioSaavn and the animation is looked up
 * on YouTube Music. That is a permission the listener grants, not a default —
 * it costs a request to a second provider, so it stays off until the full
 * player is open and Data Saver is off.
 *
 * Nothing here talks to the network. The lookup lives in `api/canvas.mjs` and
 * this module only decides whether to ask and understands the answer, so the
 * policy can be tested without a socket.
 */

/** How the lookup may end. Every branch has a sentence the UI can show. */
export const CANVAS_REASON = {
  ready: 'ready',
  closed: 'player_closed',
  dataSaver: 'data_saver_on',
  disabled: 'user_disabled',
  noTrack: 'no_track',
  notFound: 'not_found',
  blocked: 'blocked_by_upstream',
  failed: 'lookup_failed',
}

export const CANVAS_COPY = {
  [CANVAS_REASON.dataSaver]: 'Canvas is off while Data Saver is on.',
  [CANVAS_REASON.disabled]: 'Canvas is turned off in Settings.',
  [CANVAS_REASON.notFound]: 'No canvas clip found for this track.',
  [CANVAS_REASON.blocked]: 'YouTube Music did not return a canvas for this track.',
  [CANVAS_REASON.failed]: 'Couldn\'t reach YouTube Music — artwork instead.',
}

/**
 * Should the app ask YouTube Music for a clip right now?
 *
 * `open` is the full-screen player. Gating on it means a listener who never
 * opens the immersive view never causes a single request to a second provider.
 */
export function canvasDecision({
  open = false,
  dataSaver = false,
  enabled = true,
  hasTrack = false,
} = {}) {
  if (!hasTrack) return { ask: false, reason: CANVAS_REASON.noTrack }
  if (!enabled) return { ask: false, reason: CANVAS_REASON.disabled }
  if (dataSaver) return { ask: false, reason: CANVAS_REASON.dataSaver }
  if (!open) return { ask: false, reason: CANVAS_REASON.closed }
  return { ask: true, reason: CANVAS_REASON.ready }
}

/** Query for the lookup: the catalogue title, with the artist as a tie-break. */
export function canvasQuery(track) {
  if (!track) return ''
  const title = String(track.name || '').replace(/\s*\(from [^)]*\)\s*/i, '').trim()
  const artist = String(track.artist || track.subtitle || '').split(',')[0].trim()
  if (!title) return ''
  return artist ? `${title} ${artist}` : title
}

/** Never let a URL from upstream become an inline script or a data: URI. */
function safeUrl(url) {
  if (typeof url !== 'string') return null
  const u = url.trim()
  if (!/^https:\/\//i.test(u)) return null
  if (!/^(lh3\.googleusercontent\.com|[a-z0-9-]+\.googleusercontent\.com|i\.ytimg\.com|yt3\.ggpht\.com)$/i.test(new URL(u).hostname)) {
    return null
  }
  // Thumbnails are jpegs served from the same hosts; a clip is not.
  if (/=w\d+-h\d+/i.test(u) && !/=m\d+/i.test(u)) return null
  return u
}

/**
 * Find the clip URL inside an InnerTube response.
 *
 * The canvas field has moved between client versions and is not documented, so
 * rather than hard-coding a path this walks the whole tree and ranks what it
 * finds: a URL under a key mentioning "canvas" wins; otherwise a plausible
 * media URL on a Google CDN is the fallback. `path` is returned with the hit so
 * a failure can be diagnosed from a log instead of guessed at.
 */
export function pickCanvasUrl(node, { maxDepth = 24 } = {}) {
  const hits = []

  const walk = (value, path, depth) => {
    if (depth > maxDepth || value == null) return
    if (typeof value === 'string') {
      const url = safeUrl(value)
      if (!url) return
      const low = path.toLowerCase()
      let score = 0
      if (low.includes('canvas')) score += 100
      if (/\.(mp4|webm|mov)\b/i.test(url) || /=m\d+/i.test(url)) score += 20
      if (/googleusercontent/.test(url)) score += 5
      hits.push({ url, path, score })
      return
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1))
      return
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k, depth + 1)
    }
  }

  walk(node, '', 0)
  if (!hits.length) return null
  hits.sort((a, b) => b.score - a.score)
  return hits[0]
}

/**
 * Read the answer from `api/canvas`. Kept tolerant: the route may be older
 * than the client, and a malformed body must degrade to "artwork", not throw.
 */
export function readCanvasResponse(body) {
  if (!body || typeof body !== 'object') return { url: null, reason: CANVAS_REASON.failed }
  const url = safeUrl(body?.data?.videoUrl)
  if (url) return { url, videoId: body.data.videoId || null, reason: CANVAS_REASON.ready }
  const code = body?.code
  const reason =
    code === 'not_found'
      ? CANVAS_REASON.notFound
      : code === 'blocked' || code === 'upstream_error'
        ? CANVAS_REASON.blocked
        : CANVAS_REASON.failed
  return { url: null, reason }
}
