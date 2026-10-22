/**
 * Canvas video lookup — the one place that talks to YouTube Music.
 *
 * JioSaavn has no canvas data, so this is a deliberate cross-source hop: the
 * audio stays on Saavn and only the looping clip comes from YouTube. It runs
 * server-side for three reasons: YouTube blocks browser CORS, the InnerTube
 * clients want a desktop User-Agent, and the answer is worth caching at the
 * edge rather than repeating per listener.
 *
 * Everything is best-effort by design. The canvas field is undocumented and
 * moves between client versions, so a miss returns a typed reason and the app
 * draws its own visualiser instead. This route must never 500 and never hang:
 * a broken canvas is cosmetic, a hanging request is a broken song.
 */

const SEARCH_TIMEOUT = 6000
const PLAYER_TIMEOUT = 6000

const WEB_REMIX = {
  client: { clientName: 'WEB_REMIX', clientVersion: '1.20240701.00.00', hl: 'en', gl: 'US' },
}

const ANDROID_MUSIC = {
  client: {
    clientName: 'ANDROID_MUSIC',
    clientVersion: '7.27.52',
    androidSdkVersion: 31,
    hl: 'en',
    gl: 'US',
  },
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function postJson(url, body, timeoutMs, extraHeaders = {}) {
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
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) return { ok: false, status: res.status }
    return { ok: true, json: await res.json() }
  } catch (e) {
    return { ok: false, status: 0, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e) }
  } finally {
    clearTimeout(timer)
  }
}

/** Every string that looks like a media URL, with the path that found it. */
function collectUrls(node, maxDepth = 24) {
  const out = []
  const walk = (v, path, depth) => {
    if (depth > maxDepth || v == null || out.length > 4000) return
    if (typeof v === 'string') {
      if (!/^https:\/\//i.test(v)) return
      let host = ''
      try {
        host = new URL(v).hostname
      } catch {
        return
      }
      if (!/googleusercontent\.com$|ytimg\.com$|ggpht\.com$/i.test(host)) return
      if (/=w\d+-h\d+/i.test(v) && !/=m\d+/i.test(v)) return
      const low = path.toLowerCase()
      let score = 0
      if (low.includes('canvas')) score += 100
      if (/\.(mp4|webm|mov)\b/i.test(v) || /=m\d+/i.test(v)) score += 20
      out.push({ url: v, path, score })
      return
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) walk(v[i], `${path}[${i}]`, depth + 1)
      return
    }
    if (typeof v === 'object') {
      for (const k of Object.keys(v)) walk(v[k], path ? `${path}.${k}` : k, depth + 1)
    }
  }
  walk(node, '', 0)
  out.sort((a, b) => b.score - a.score)
  return out
}

/** First videoId anywhere in a search response that looks like a song. */
function firstVideoId(json) {
  const seen = []
  const walk = (v, depth) => {
    if (depth > 22 || v == null) return
    if (Array.isArray(v)) {
      v.forEach((x) => walk(x, depth + 1))
      return
    }
    if (typeof v === 'object') {
      if (typeof v.videoId === 'string' && /^[\w-]{11}$/.test(v.videoId)) {
        // Song results carry a page type of MUSIC_PAGE / ATV; videos carry
        // MUSIC_VIDEO_TYPE_OMV or UGC. Prefer the song entry when present.
        let score = 0
        const blob = JSON.stringify(v).slice(0, 4000)
        if (/MUSIC_VIDEO_TYPE_ATV/.test(blob)) score += 30
        if (/MUSIC_VIDEO_TYPE_OMV/.test(blob)) score += 10
        if (/MUSIC_VIDEO_TYPE_UGC/.test(blob)) score -= 10
        seen.push({ videoId: v.videoId, score })
      }
      for (const k of Object.keys(v)) walk(v[k], depth + 1)
    }
  }
  walk(json, 0)
  if (!seen.length) return null
  seen.sort((a, b) => b.score - a.score)
  return seen[0].videoId
}

async function search(youtubeHost, query) {
  const body = { context: WEB_REMIX, query, params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D' }
  const r = await postJson(`https://${youtubeHost}/youtubei/v1/search?prettyPrint=false`, body, SEARCH_TIMEOUT)
  if (!r.ok) return { ok: false, status: r.status }
  const videoId = firstVideoId(r.json)
  return videoId ? { ok: true, videoId } : { ok: false, status: 'no_results' }
}

async function canvasFor(youtubeHost, videoId) {
  for (const client of [ANDROID_MUSIC, WEB_REMIX]) {
    const r = await postJson(
      `https://${youtubeHost}/youtubei/v1/player?prettyPrint=false`,
      { context: client, videoId, contentCheckOk: true, racyCheckOk: true },
      PLAYER_TIMEOUT,
      client === ANDROID_MUSIC ? { 'user-agent': 'com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 13)' } : {}
    )
    if (!r.ok) continue
    const hits = collectUrls(r.json)
    if (hits.length) return { url: hits[0].url, path: hits[0].path, client: client.client.clientName }
  }
  return null
}

export default async function handler(req, res) {
  const q = req.query || {}
  const title = String(q.title || '').slice(0, 160)
  const artist = String(q.artist || '').slice(0, 80)
  const query = `${title} ${artist}`.trim()

  if (!title) {
    res.status(400).json({ success: false, code: 'bad_request', message: 'A song title is required.' })
    return
  }

  const debug = q.debug === '1'

  try {
    // music.youtube.com and www.youtube.com serve the same InnerTube API; the
    // music host has the mixes, the plain host is a fallback if it is gated.
    let found = null
    let lastStatus = 0
    for (const host of ['music.youtube.com', 'www.youtube.com']) {
      const s = await search(host, query)
      if (!s.ok) {
        lastStatus = s.status
        continue
      }
      const c = await canvasFor(host, s.videoId)
      if (c) {
        found = { ...c, videoId: s.videoId, host }
        break
      }
    }

    if (!found) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
      res.status(200).json({
        success: false,
        code: lastStatus === 429 ? 'blocked' : 'not_found',
        message: 'No canvas clip was found for this track.',
        ...(debug ? { debug: { query, lastStatus } } : {}),
      })
      return
    }

    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400')
    res.status(200).json({
      success: true,
      data: {
        videoUrl: found.url,
        videoId: found.videoId,
        source: 'youtube-music',
        client: found.client,
        ...(debug ? { debug: { query, path: found.path, host: found.host } } : {}),
      },
    })
  } catch (e) {
    // A cosmetic lookup must never surface as a failed request.
    res.status(200).json({
      success: false,
      code: 'upstream_error',
      message: String(e?.message || e).slice(0, 200),
    })
  }
}
