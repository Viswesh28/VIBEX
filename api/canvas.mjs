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
/**
 * The probe has to exercise the *music* path.
 *
 * A plain UGC video plays fine from this deployment while every music track is
 * refused, so probing with one would report "available" and then spend a
 * lookup on every song to be told otherwise. This is a fixed, widely available
 * music track; the query is resolved through search exactly like a real one.
 */
const HEALTH_QUERY = 'Blinding Lights The Weeknd'

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
/** ytmusicapi sends exactly this from an unauthenticated client. */
const YTM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0'
const YTM_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30'

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
    const text = await res.text()
    if (!res.ok) return { ok: false, status: res.status, body: text.slice(0, 120) }
    try {
      return { ok: true, json: JSON.parse(text) }
    } catch {
      return { ok: false, status: res.status, error: 'non_json', body: text.slice(0, 120) }
    }
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
  if (!r.ok) return { ok: false, status: r.status, error: r.error || null }
  const videoId = firstVideoId(r.json)
  return videoId ? { ok: true, videoId } : { ok: false, status: 'no_results' }
}

async function canvasFor(youtubeHost, videoId) {
  const diag = []
  let gate = null
  for (const client of [ANDROID_MUSIC, WEB_REMIX]) {
    const name = client.client.clientName
    const r = await postJson(
      `https://${youtubeHost}/youtubei/v1/player?prettyPrint=false`,
      { context: client, videoId, contentCheckOk: true, racyCheckOk: true },
      PLAYER_TIMEOUT,
      client === ANDROID_MUSIC ? { 'user-agent': 'com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 13)' } : {}
    )
    if (!r.ok) {
      diag.push({ client: name, ok: false, status: r.status, error: r.error || r.body || null })
      continue
    }
    const play = r.json?.playabilityStatus
    if (play && /LOGIN_REQUIRED|AGE_CHECK_REQUIRED|ERROR/i.test(String(play.status))) {
      gate = { status: play.status, reason: play.reason || null }
    }
    const hits = collectUrls(r.json)
    let blob = ''
    try {
      blob = JSON.stringify(r.json)
    } catch {
      blob = ''
    }
    // Shape, not payload: how big is the response, which top-level sections did
    // it return, and does the word "canvas" appear anywhere at all?
    diag.push({
      client: name,
      ok: true,
      bytes: blob.length,
      keys: Object.keys(r.json || {}).slice(0, 24),
      playability: r.json?.playabilityStatus
        ? { status: r.json.playabilityStatus.status, reason: r.json.playabilityStatus.reason || null }
        : null,
      hasCanvas: /canvas/i.test(blob),
      hits: hits.length,
      paths: hits.slice(0, 3).map((h) => h.path),
    })
    if (hits.length) {
      return { found: { url: hits[0].url, path: hits[0].path, client: name }, diag, gate }
    }
  }
  const page = await watchPage(youtubeHost, videoId)
  diag.push({ client: 'watch_page', host: youtubeHost, ...page.summary })
  if (page.found) return { found: page.found, diag, gate }
  return { found: null, diag, gate }
}

async function watchPage(youtubeHost, videoId) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const r = await fetch(`https://${youtubeHost}/watch?v=${videoId}&hl=en&gl=US`, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
    })
    const html = await r.text()
    const summary = { ok: r.ok, status: r.status, bytes: html.length, hasCanvas: /canvas/i.test(html) }
    if (!r.ok) return { summary: { ...summary, ok: false }, found: null }
    const hits = collectUrls({ html })
    summary.hits = hits.length
    summary.paths = hits.slice(0, 3).map((h) => h.path)
    return { summary, found: hits.length ? { url: hits[0].url, path: hits[0].path, client: 'watch_page' } : null }
  } catch (e) {
    return { summary: { ok: false, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e) }, found: null }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Diagnostic only, behind `debug=1`: is this function able to leave the
 * building at all? Without it a failed lookup is ambiguous between "YouTube
 * refused" and "this deployment has no egress", which are very different bugs.
 */
async function hostCheck(host) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const r = await fetch(`https://${host}/`, {
      method: 'GET',
      signal: ctrl.signal,
      redirect: 'manual',
      headers: { 'user-agent': UA },
    })
    return { ok: true, status: r.status }
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e) }
  } finally {
    clearTimeout(timer)
  }
}

async function egressCheck() {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 4000)
  try {
    const r = await fetch('https://www.google.com/generate_204', {
      method: 'GET',
      signal: ctrl.signal,
      redirect: 'manual',
    })
    return { ok: true, status: r.status }
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Is this deployment allowed to look at YouTube at all?
 *
 * The lookup can fail for a dull reason: from a datacenter IP, YouTube answers
 * the player call with `LOGIN_REQUIRED` / "confirm you're not a bot". That is
 * not a property of the song, and it is not something a different query fixes.
 * One cheap player call, on a single fixed video, tells the app whether asking
 * per-track is worth anything — and because it is cheap it can be re-run, so
 * the feature turns itself back on if the deployment stops being challenged.
 */
async function health() {
  // Search first, for the same reason the feature does: an ATV track id is what
  // the player refuses, and a hard-coded id would go stale or be geo-restricted.
  const s = await search('music.youtube.com', HEALTH_QUERY)
  if (!s.ok) return { canvas: 'unknown', reason: `search_${s.status}`, detail: s.error || null }

  const r = await postJson(
    'https://music.youtube.com/youtubei/v1/player?prettyPrint=false',
    { context: WEB_REMIX, videoId: s.videoId, contentCheckOk: true, racyCheckOk: true },
    PLAYER_TIMEOUT
  )
  if (!r.ok) return { canvas: 'unknown', reason: `player_${r.status}`, detail: r.error || r.body || null }

  const play = r.json?.playabilityStatus
  let blob = ''
  try {
    blob = JSON.stringify(r.json)
  } catch {
    blob = ''
  }
  if (play && /LOGIN_REQUIRED|AGE_CHECK_REQUIRED|ERROR/i.test(String(play.status))) {
    return { canvas: 'deployment_blocked', reason: play.reason || null, probe: s.videoId }
  }
  if (/streamingData|videoDetails/.test(blob)) return { canvas: 'available', probe: s.videoId }
  return { canvas: 'unknown', reason: play?.status || null, probe: s.videoId }
}

/**
 * The ytmusicapi recipe, ported to see whether it behaves differently here.
 *
 * sigma67/ytmusicapi is the most-used unauthenticated YouTube Music client, and
 * its request shape differs from ours in four ways we did not send: a client
 * version built from *today's* date, the public web API key, a visitor id read
 * from the page's own `ytcfg`, and a `signatureTimestamp` parsed out of
 * `base.js`. If any of those is what makes its requests acceptable, this probe
 * shows it — and if it fails identically, the block is not about our request.
 *
 * Its own test suite skips the unauthenticated streaming assertion on GitHub CI
 * ("doesn't work for some reason"), which is a datacenter IP like this one.
 * That is a reason to check rather than assume, not a reason to skip checking.
 */
async function recipeProbe(videoId) {
  const out = { recipe: 'ytmusicapi', videoId, steps: [] }

  const pageResp = await fetch('https://music.youtube.com/', {
    headers: { 'user-agent': YTM_UA, accept: '*/*' },
  })
  const page = await pageResp.text()
  out.steps.push({ step: 'page', status: pageResp.status, bytes: page.length })

  const cfgMatch = /ytcfg\.set\s*\(\s*({.+?})\s*\)\s*;/.exec(page)
  let visitorId = ''
  if (cfgMatch) {
    try {
      visitorId = JSON.parse(cfgMatch[1]).VISITOR_DATA || ''
    } catch {
      visitorId = ''
    }
  }
  const jsMatch = /jsUrl"\s*:\s*"([^"]+)"/.exec(page)
  out.steps.push({ step: 'ytcfg', visitor: visitorId ? 'present' : 'absent', jsUrl: jsMatch ? 'present' : 'absent' })

  let signatureTimestamp = null
  if (jsMatch) {
    const basejs = await fetch('https://music.youtube.com' + jsMatch[1], {
      headers: { 'user-agent': YTM_UA },
    })
    const js = await basejs.text()
    const sts = /signatureTimestamp[:=](\d+)/.exec(js)
    signatureTimestamp = sts ? Number(sts[1]) : null
    out.steps.push({ step: 'basejs', status: basejs.status, bytes: js.length, signatureTimestamp })
  }

  const body = {
    context: {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: '1.' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.01.00',
      },
      user: {},
    },
    videoId,
  }
  if (signatureTimestamp) {
    body.playbackContext = { contentPlaybackContext: { signatureTimestamp } }
  }

  const url = `https://music.youtube.com/youtubei/v1/player?alt=json&key=${YTM_KEY}`
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'user-agent': YTM_UA,
      accept: '*/*',
      'content-type': 'application/json',
      origin: 'https://music.youtube.com',
      ...(visitorId ? { 'x-goog-visitor-id': visitorId } : {}),
    },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  const play = json?.playabilityStatus
  out.steps.push({
    step: 'player',
    status: r.status,
    bytes: text.length,
    playability: play ? { status: play.status, reason: play.reason || null } : null,
    hasStreaming: /streamingData/i.test(text),
    hasCanvas: /canvas/i.test(text),
    formats: Array.isArray(json?.streamingData?.adaptiveFormats)
      ? json.streamingData.adaptiveFormats.length
      : 0,
  })
  out.verdict = !json
    ? 'non_json'
    : play && /LOGIN_REQUIRED|ERROR|AGE_CHECK/i.test(String(play.status))
      ? 'gated'
      : /streamingData/i.test(text)
        ? 'works'
        : 'no_streaming'
  return out
}

export default async function handler(req, res) {
  const q = req.query || {}

  // `?recipe=1&videoId=…` runs the ytmusicapi request shape end to end.
  if (q.recipe === '1') {
    const videoId = String(q.videoId || 'J7p4bzqLvCw')
    res.setHeader('Cache-Control', 'no-store')
    try {
      res.status(200).json({ success: true, data: await recipeProbe(videoId) })
    } catch (e) {
      res.status(200).json({ success: false, code: 'probe_failed', message: String(e?.message || e).slice(0, 200) })
    }
    return
  }

  // `?health=1` answers only "may this deployment ask?", never about a song.
  // Short-cached when blocked, so a promotion or an unblock is noticed quickly.
  if (q.health === '1') {
    const h = await health()
    res.setHeader(
      'Cache-Control',
      h.canvas === 'available'
        ? 'public, s-maxage=3600, stale-while-revalidate=600'
        : 'public, s-maxage=60, stale-while-revalidate=120'
    )
    res.status(200).json({ success: true, data: h })
    return
  }

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
    let lastError = null
    let stage = 'search'
    let gate = null
    const steps = []
    for (const host of ['music.youtube.com', 'www.youtube.com']) {
      const s = await search(host, query)
      if (!s.ok) {
        lastStatus = s.status
        lastError = s.error || s.body || null
        steps.push({ host, stage: 'search', status: s.status, error: s.error || s.body || null })
        continue
      }
      steps.push({ host, stage: 'search', status: 'ok', videoId: s.videoId })
      stage = 'player'
      const c = await canvasFor(host, s.videoId)
      steps.push(...c.diag.map((d) => ({ host, stage: 'player', ...d })))
      if (c.gate) gate = c.gate
      if (c.found) {
        found = { ...c.found, videoId: s.videoId, host }
        break
      }
    }

    if (!found) {
      // A challenge is not a property of the song: it is this deployment being
      // asked to sign in. Say so, cache it briefly, and let the probe re-check.
      res.setHeader(
        'Cache-Control',
        gate ? 'public, s-maxage=60, stale-while-revalidate=120' : 'public, s-maxage=300, stale-while-revalidate=600'
      )
      res.status(200).json({
        success: false,
        code: gate ? 'deployment_blocked' : lastStatus === 429 ? 'blocked' : 'not_found',
        message: gate
          ? 'YouTube asked this server to sign in, so no clip can be fetched here.'
          : 'No canvas clip was found for this track.',
        ...(debug ? { debug: { query, stage, gate, lastStatus, lastError, steps, egress: await egressCheck(), hosts: {
            music: await hostCheck('music.youtube.com'),
            www: await hostCheck('www.youtube.com'),
            lh3: await hostCheck('lh3.googleusercontent.com'),
          } } } : {}),
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
