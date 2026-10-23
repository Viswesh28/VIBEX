/**
 * /api/import-playlist  --  Universal Share-to-VIBEX & Playlist / Track Resolver.
 *
 * Resolves BOTH single shared songs/videos AND full playlists/albums/artists from:
 *  - YouTube & YouTube Music single videos/songs/shorts (`watch?v=...`, `youtu.be/...`, `/shorts/...`)
 *  - YouTube & YouTube Music playlists & albums (`?list=PL...`, `/browse/MPREb_...`, `OLAK5uy_...`)
 *  - Spotify single tracks, albums, playlists, artists & mobile short links (`spotify.link`, `spoti.fi`)
 *    with triple-redundant metadata extraction (`embed __NEXT_DATA__` -> `oEmbed` -> OpenGraph tags)
 *  - JioSaavn single songs, albums, playlists/charts & artists
 *  - Apple Music song / album share links & plain pasted text (`Artist - Song`, Shazam shares)
 *
 * Every resolved track is mapped into a playable VIBEX song object backed by `320kbps`
 * studio audio where available (with pure-audio `/api/ytaudio` fallback for YT exclusives).
 */

import saavnApp from '../jiosaavn-api/src/server.js'
import { enrichResultsWithSaavnAudio, listItemRenderers, toResult } from './ytmusic.mjs'
import { unescapeEntities } from './_lib/trackMatch.mjs'

const MAX_IMPORT_TRACKS = 100
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const ALLOWED_REDIRECT_HOSTS = new Set([
  'spotify.com',
  'open.spotify.com',
  'play.spotify.com',
  'spotify.link',
  'spoti.fi',
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'jiosaavn.com',
  'www.jiosaavn.com',
  'saavn.com',
  'www.saavn.com',
  'music.apple.com',
  'geo.music.apple.com',
])

function isAllowedExternalHost(hostname = '') {
  return ALLOWED_REDIRECT_HOSTS.has(String(hostname || '').toLowerCase())
}

async function unwrapRedirectIfNeeded(rawUrl, fetchImpl = fetch) {
  let current = String(rawUrl || '').trim()
  for (let hop = 0; hop < 4; hop++) {
    let parsed
    try {
      parsed = new URL(current)
    } catch {
      break
    }
    if (parsed.protocol !== 'https:' || !isAllowedExternalHost(parsed.hostname)) break
    const host = parsed.hostname.toLowerCase()
    const needsUnwrap = host === 'spotify.link' || host === 'spoti.fi'
    if (!needsUnwrap) return current

    const res = await fetchImpl(current, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'user-agent': UA, accept: 'text/html' },
      signal: AbortSignal.timeout(6000),
    }).catch(() => null)
    if (!res) break
    const loc = res.headers?.get?.('location')
    if (!loc) {
      if (res.url && res.url !== current) current = res.url
      break
    }
    current = new URL(loc, current).toString()
  }
  return current
}

async function callSaavn(path, customFetch = null) {
  if (customFetch) {
    try {
      const extRes = await customFetch(`https://vibex.internal/api${path}`, {
        headers: { accept: 'application/json' },
      })
      if (extRes?.ok) {
        const extJson = await extRes.json().catch(() => null)
        if (extJson?.success) return extJson.data
      }
    } catch {
      /* fall through to in-process Hono app */
    }
  }
  const res = await saavnApp.fetch(
    new Request(`https://vibex.internal/api${path}`, {
      headers: { accept: 'application/json' },
    })
  )
  if (!res.ok) return null
  const json = await res.json().catch(() => null)
  return json?.success ? json.data : null
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

export function parseTextTracklist(rawText = '') {
  return String(rawText || '')
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:\d+[.)]\s*|[-*•]\s*)/, '')
        .replace(/\s*\(\d{1,2}:\d{2}\)\s*$/, '')
        .trim()
    )
    .filter((line) => line.length >= 2)
    .slice(0, MAX_IMPORT_TRACKS)
    .map((line) => {
      const parts = line.split(/\s+(?:[-–—]|\|)\s+/)
      if (parts.length >= 2) {
        return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim(), query: line }
      }
      return { artist: '', title: line, query: line }
    })
}

const LABEL_CHANNEL_RE =
  /\b(records?|music|entertainment|pictures|films?|studios?|productions?|audio|t-?series|yrf|sony|zee|saregama|aditya|lahari|think|sun\s+tv|tips|junglee|mythri|hombale|divo|ayngaran|vevo)\b/i

function artistTokens(str = '') {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && w !== 'the' && w !== 'and')
}

function pickBestSaavnCandidate(results = [], entry = {}) {
  if (!Array.isArray(results) || !results.length) return null
  const rawArtist = String(entry.artist || '')
    .split(/[,&]|feat\.?|ft\.?/i)[0]
    .trim()
  const wantTokens = artistTokens(rawArtist)
  const enforcePerformerMatch = wantTokens.length > 0 && !LABEL_CHANNEL_RE.test(rawArtist)
  const wantTitle = String(entry.title || entry.query || '').toLowerCase()
  const wantsCoverOrInst = /\b(instrumental|karaoke|cover|lofi|8d|slowed|reverb|piano)\b/i.test(wantTitle)

  let best = null
  let bestScore = -Infinity
  for (let i = 0; i < results.length; i++) {
    const c = results[i]
    if (!c?.id || !c?.downloadUrl?.length) continue
    const performerText = [...(c.artists?.primary || []), ...(c.artists?.featured || [])]
      .map((a) => String(a.name || '').toLowerCase())
      .join(' | ')
    const allNames = (c.artists?.all || []).map((a) => String(a.name || '').toLowerCase()).join(' | ')
    const candText = `${c.name || ''} ${c.album?.name || ''} ${performerText}`.toLowerCase()

    // Hard 1:1 performer guard: when a real singer/band is known (e.g. "Rick Astley",
    // "The Weeknd", "Taylor Swift"), never substitute a cover/tribute act ("The Piano Guys")
    // that only credits the original artist as songwriter in `artists.all`!
    const hasPerformerOverlap = wantTokens.some((tok) => performerText.includes(tok))
    if (enforcePerformerMatch && !hasPerformerOverlap) {
      continue
    }

    let score = Math.max(0, 12 - i * 2)
    if (hasPerformerOverlap) score += 50
    else if (wantTokens.some((tok) => allNames.includes(tok))) score += 12

    if (!wantsCoverOrInst && /\b(instrumental|karaoke|tribute|piano guys|ringtone)\b/i.test(candText)) {
      score -= 40
    }
    const plays = Number(c.playCount || 0)
    if (plays > 0) score += Math.min(18, Math.log10(plays + 1) * 2.5)

    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  if (best) return best
  return enforcePerformerMatch ? null : results[0] || null
}

async function resolveViaYouTubeMusicSearch(entry, fetchImpl = fetch) {
  const effectiveFetch = fetchImpl || globalThis.fetch
  if (typeof effectiveFetch !== 'function') return null
  const res = await effectiveFetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': UA,
      origin: 'https://music.youtube.com',
      referer: 'https://music.youtube.com/',
    },
    body: JSON.stringify({
      context: {
        client: { clientName: 'WEB_REMIX', clientVersion: '1.20250312.01.00', hl: 'en', gl: 'IN' },
      },
      query: entry.query,
      // Official YT Music "Songs" filter param so studio audio tracks rank first
      params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D',
    }),
    signal: AbortSignal.timeout(6500),
  }).catch(() => null)
  if (!res?.ok) return null
  const raw = await res.json().catch(() => null)
  const item = listItemRenderers(raw).map(toResult).filter(Boolean)[0]
  if (!item?.id) return null
  return {
    id: `yt:${item.id}`,
    name: unescapeEntities(item.title || entry.title || 'Track'),
    type: 'song',
    duration: Number(item.duration) || 0,
    album: { id: '', name: unescapeEntities(item.album || '') },
    artists: {
      primary: (item.artists?.length
        ? item.artists
        : [{ id: '', name: entry.artist || 'YouTube Music' }]
      ).map((a) => ({ id: a.id || '', name: unescapeEntities(a.name || '') })),
      featured: [],
      all: [],
    },
    image: [
      {
        quality: '500x500',
        url: item.thumbnail || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
      },
    ],
    downloadUrl: [{ quality: '160kbps', url: `/api/ytaudio?id=${item.id}` }],
  }
}

async function resolveTextQueriesToSaavn(entries, fetchImpl = null) {
  const out = new Array(entries.length).fill(null)
  let cursor = 0
  const worker = async () => {
    while (cursor < entries.length) {
      const idx = cursor++
      const entry = entries[idx]
      const d = await callSaavn(
        `/search/songs?query=${encodeURIComponent(entry.query)}&limit=8`,
        fetchImpl
      ).catch(() => null)
      let hit = pickBestSaavnCandidate(d?.results || [], entry)
      if (!hit && entries.length <= 25) {
        hit = await resolveViaYouTubeMusicSearch(entry, fetchImpl)
      }
      if (hit?.id && hit?.downloadUrl?.length) out[idx] = hit
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, entries.length) }, () => worker()))
  return out.filter(Boolean)
}

async function importFromJioSaavnUrl(sourceUrl, fetchImpl = null) {
  const isSong = /\/song\//i.test(sourceUrl)
  const isAlbum = /\/album\//i.test(sourceUrl)
  const isArtist = /\/artist\//i.test(sourceUrl)

  if (isSong) {
    const data = await callSaavn(`/songs?link=${encodeURIComponent(sourceUrl)}`, fetchImpl)
    const songs = Array.isArray(data) ? data : data?.songs || []
    if (!songs.length) throw new Error('Could not resolve that JioSaavn song.')
    return {
      kind: 'track',
      name: unescapeEntities(songs[0].name || 'Shared JioSaavn Song'),
      sourceType: 'jiosaavn',
      requestedCount: 1,
      tracks: [songs[0]],
    }
  }

  if (isArtist) {
    const data = await callSaavn(`/artists?link=${encodeURIComponent(sourceUrl)}`, fetchImpl)
    const topSongs = data?.topSongs || []
    if (!topSongs.length) throw new Error('Could not find playable top tracks for that JioSaavn artist.')
    return {
      kind: 'collection',
      name: unescapeEntities(data.name || 'Artist Top Songs'),
      sourceType: 'jiosaavn',
      requestedCount: topSongs.length,
      tracks: topSongs.slice(0, MAX_IMPORT_TRACKS),
    }
  }

  const endpoint = isAlbum
    ? `/albums?link=${encodeURIComponent(sourceUrl)}`
    : `/playlists?link=${encodeURIComponent(sourceUrl)}&limit=${MAX_IMPORT_TRACKS}`
  const data = await callSaavn(endpoint, fetchImpl)
  if (!data?.songs?.length) {
    throw new Error('Could not find playable songs at that JioSaavn link.')
  }
  return {
    kind: 'collection',
    name: unescapeEntities(data.name || 'Imported JioSaavn Playlist'),
    sourceType: 'jiosaavn',
    requestedCount: data.songs.length,
    tracks: data.songs.slice(0, MAX_IMPORT_TRACKS),
  }
}

function cleanYouTubeTitleForSearch(rawTitle = '') {
  return unescapeEntities(rawTitle)
    .replace(/\s*[\(\[](?:official\s*(?:music\s*)?video|official\s*audio|lyric\s*video|lyrics?|4k|hd|full\s*video(?:\s*song)?|audio|visualizer)[^)\]]*[\)\]]/gi, '')
    .replace(/\s*\|\s*(?:official|full\s*video|lyric|4k).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function importSingleYouTubeVideo(videoId, hintTitle = '', fetchImpl = fetch) {
  let ytTitle = cleanYouTubeTitleForSearch(hintTitle)
  let ytAuthor = ''
  let ytDuration = 0

  // 1. Official YouTube JSON oEmbed — fast (~60ms) & never datacenter-blocked on Vercel AWS IPs
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`
  const oeRes = await fetchImpl(oembedUrl, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  }).catch(() => null)
  if (oeRes?.ok) {
    const oe = await oeRes.json().catch(() => null)
    if (oe?.title) ytTitle = cleanYouTubeTitleForSearch(oe.title) || ytTitle
    if (oe?.author_name) {
      ytAuthor = unescapeEntities(oe.author_name)
        .replace(/\s*-\s*Topic$/i, '')
        .replace(/VEVO$/i, '')
        .trim()
    }
  }

  // 2. InnerTube `youtubei/v1/player` fallback if video had embedding disabled
  if (!ytTitle) {
    const itRes = await fetchImpl('https://music.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': UA,
        origin: 'https://music.youtube.com',
        referer: 'https://music.youtube.com/',
      },
      body: JSON.stringify({
        context: {
          client: { clientName: 'WEB_REMIX', clientVersion: '1.20250312.01.00', hl: 'en', gl: 'IN' },
        },
        videoId,
      }),
      signal: AbortSignal.timeout(6000),
    }).catch(() => null)
    if (itRes?.ok) {
      const itJson = await itRes.json().catch(() => null)
      const vd = itJson?.videoDetails
      if (vd?.title) ytTitle = cleanYouTubeTitleForSearch(vd.title)
      if (vd?.author) ytAuthor = unescapeEntities(vd.author).replace(/\s*-\s*Topic$/i, '').trim()
      ytDuration = Number(vd?.lengthSeconds) || 0
    }
  }

  // 3. Match against 320kbps studio audio first ONLY when verified 1:1 performer match exists
  if (ytTitle) {
    const query = ytAuthor && !ytTitle.toLowerCase().includes(ytAuthor.toLowerCase())
      ? `${ytTitle} ${ytAuthor}`
      : ytTitle
    const d = await callSaavn(`/search/songs?query=${encodeURIComponent(query)}&limit=8`, fetchImpl).catch(
      () => null
    )
    const saavnMatch = pickBestSaavnCandidate(d?.results || [], {
      artist: ytAuthor,
      title: ytTitle,
      query,
    })
    if (saavnMatch?.id && saavnMatch?.downloadUrl?.length) {
      return {
        kind: 'track',
        name: unescapeEntities(saavnMatch.name || ytTitle),
        sourceType: 'youtube',
        requestedCount: 1,
        tracks: [saavnMatch],
      }
    }
  }

  // 4. Pure-audio direct `/api/ytaudio` fallback for YouTube-exclusive uploads / remixes / covers
  const cleanTitle = unescapeEntities(ytTitle || hintTitle || 'YouTube Audio Track')
  const cleanArtist = ytAuthor || 'YouTube Music'
  return {
    kind: 'track',
    name: cleanTitle,
    sourceType: 'youtube',
    requestedCount: 1,
    tracks: [
      {
        id: `yt:${videoId}`,
        name: cleanTitle,
        type: 'song',
        duration: ytDuration,
        artists: { primary: [{ id: '', name: cleanArtist }], featured: [], all: [] },
        image: [
          { quality: '500x500', url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` },
        ],
        downloadUrl: [{ quality: '160kbps', url: `/api/ytaudio?id=${videoId}` }],
      },
    ],
  }
}

async function importFromYouTubePlaylist(listId, fetchImpl = fetch) {
  const browseId = /^(?:VL|MPREb_)/i.test(listId) ? listId : `VL${listId}`
  const res = await fetchImpl('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': UA,
      origin: 'https://music.youtube.com',
      referer: 'https://music.youtube.com/',
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: '1.20250312.01.00',
          hl: 'en',
          gl: 'IN',
        },
      },
      browseId,
    }),
    signal: AbortSignal.timeout(9000),
  })
  if (!res.ok) throw new Error('YouTube Music declined the playlist request.')
  const raw = await res.json()

  const titleMatch =
    raw?.header?.musicResponsiveHeaderRenderer?.title?.runs?.map((r) => r.text).join('') ||
    raw?.header?.musicDetailHeaderRenderer?.title?.runs?.map((r) => r.text).join('') ||
    'Imported YouTube Playlist'

  const ytItems = listItemRenderers(raw).map(toResult).filter(Boolean).slice(0, MAX_IMPORT_TRACKS)
  if (!ytItems.length) throw new Error('No playable tracks found in that YouTube playlist.')

  const enriched = await enrichResultsWithSaavnAudio(ytItems, { concurrency: 6 })
  const tracks = enriched.map((item) => {
    const matched = item.matchedAudio
    const vid = item.id
    return {
      id: matched?.songId || `yt:${vid}`,
      name: unescapeEntities(item.title || matched?.name || 'Track'),
      duration: Number(matched?.duration || item.duration) || 0,
      language: matched?.language || '',
      hasLyrics: Boolean(matched?.hasLyrics),
      lyricsId: matched?.lyricsId || null,
      album: {
        id: matched?.album?.id || '',
        name: unescapeEntities(matched?.album?.name || item.album || ''),
      },
      artists: {
        primary: (item.artists?.length ? item.artists : [{ name: 'YouTube Music' }]).map((a) => ({
          id: a.id || '',
          name: unescapeEntities(a.name || ''),
        })),
      },
      image: matched?.image?.length
        ? matched.image
        : [{ quality: '500x500', url: item.thumbnail || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` }],
      downloadUrl: matched?.downloadUrl?.length
        ? matched.downloadUrl
        : [{ quality: '160kbps', url: `/api/ytaudio?id=${vid}` }],
      ...(matched?.songId ? { _matchedSaavnId: matched.songId } : {}),
    }
  })

  return {
    kind: 'collection',
    name: unescapeEntities(titleMatch),
    sourceType: 'youtube',
    requestedCount: ytItems.length,
    tracks,
  }
}

function extractMetaTag(html, prop) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
    'i'
  )
  const m = re.exec(html)
  return unescapeEntities(m?.[1] || m?.[2] || '').trim()
}

async function importFromSpotifyEntity(entityType, entityId, hintTitle = '', fetchImpl = fetch) {
  const canonicalUrl = `https://open.spotify.com/${entityType}/${encodeURIComponent(entityId)}`
  let entity = null
  let html = ''

  const embedRes = await fetchImpl(
    `https://open.spotify.com/embed/${entityType}/${encodeURIComponent(entityId)}`,
    {
      headers: { 'user-agent': UA, accept: 'text/html' },
      signal: AbortSignal.timeout(9000),
    }
  ).catch(() => null)

  if (embedRes?.ok) {
    html = await embedRes.text().catch(() => '')
    const nextDataMatch = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html)
    if (nextDataMatch) {
      try {
        const parsed = JSON.parse(nextDataMatch[1])
        entity = parsed?.props?.pageProps?.state?.data?.entity || null
      } catch {
        entity = null
      }
    }
  }

  // Single-track Spotify resolution (`open.spotify.com/track/<id>`)
  if (entityType === 'track') {
    let title = unescapeEntities(entity?.title || entity?.name || '')
    let artist = unescapeEntities(
      entity?.artists?.map((a) => a.name).join(', ') || entity?.subtitle || ''
    )

    if (!title) {
      const oembedRes = await fetchImpl(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(canonicalUrl)}`,
        { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(6000) }
      ).catch(() => null)
      if (oembedRes?.ok) {
        const oe = await oembedRes.json().catch(() => null)
        title = unescapeEntities(oe?.title || '')
      }
    }
    if (html) {
      if (!title) title = extractMetaTag(html, 'og:title')
      const desc = extractMetaTag(html, 'og:description')
      if (desc && !artist) artist = desc.split('·')[0].trim()
    }
    if (!artist || !title) {
      const pageRes = await fetchImpl(canonicalUrl, {
        headers: { 'user-agent': UA, accept: 'text/html' },
        signal: AbortSignal.timeout(6000),
      }).catch(() => null)
      if (pageRes?.ok) {
        const pageHtml = await pageRes.text().catch(() => '')
        if (!title) title = extractMetaTag(pageHtml, 'og:title')
        const pageDesc = extractMetaTag(pageHtml, 'og:description')
        if (pageDesc && !artist) artist = pageDesc.split('·')[0].trim()
        if (!artist) {
          const byMatch = /<title>[^<]*?-\s*song(?:\s+and\s+lyrics)?\s+by\s+([^|<]+?)\s*\|\s*Spotify<\/title>/i.exec(
            pageHtml
          )
          if (byMatch) artist = unescapeEntities(byMatch[1]).trim()
        }
      }
    }
    if (!title && hintTitle) title = hintTitle
    if (!title) throw new Error('Could not read track metadata from that Spotify link.')

    const query = [title, artist].filter(Boolean).join(' ').trim()
    const resolved = await resolveTextQueriesToSaavn([{ artist, title, query }], fetchImpl)
    if (!resolved.length) {
      throw new Error(`Could not find a playable stream for “${title}”.`)
    }
    return {
      kind: 'track',
      name: title,
      sourceType: 'spotify',
      requestedCount: 1,
      tracks: [resolved[0]],
    }
  }

  // Spotify Playlist / Album / Artist collection
  const trackList = entity?.trackList || []
  if (!trackList.length) {
    throw new Error('Spotify collection metadata unavailable — try pasting its tracklist lines.')
  }

  const entries = trackList.slice(0, MAX_IMPORT_TRACKS).map((t) => ({
    artist: t.subtitle || '',
    title: t.title || '',
    query: `${t.title || ''} ${t.subtitle || ''}`.trim(),
  }))
  const tracks = await resolveTextQueriesToSaavn(entries, fetchImpl)
  return {
    kind: 'collection',
    name: unescapeEntities(entity?.name || entity?.title || `Imported Spotify ${entityType}`),
    sourceType: 'spotify',
    requestedCount: entries.length,
    tracks,
  }
}

async function importFromAppleMusicUrl(sourceUrl, hintTitle = '', fetchImpl = fetch) {
  let query = hintTitle
  if (!query) {
    const pageRes = await fetchImpl(sourceUrl, {
      headers: { 'user-agent': UA, accept: 'text/html' },
      signal: AbortSignal.timeout(6500),
    }).catch(() => null)
    if (pageRes?.ok) {
      const html = await pageRes.text().catch(() => '')
      query = extractMetaTag(html, 'og:title').replace(/\s+on Apple Music$/i, '').trim()
    }
  }
  if (!query) throw new Error('Could not read song details from that Apple Music link.')
  const tracks = await resolveTextQueriesToSaavn(
    [{ artist: '', title: query, query }],
    fetchImpl
  )
  if (!tracks.length) throw new Error(`No playable match found for “${query}”.`)
  return {
    kind: 'track',
    name: query,
    sourceType: 'apple',
    requestedCount: 1,
    tracks: [tracks[0]],
  }
}

function sendJson(res, status, payload) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(status).json(payload)
    return
  }
  if (typeof res.writeHead === 'function') {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  } else {
    res.statusCode = status
    res.setHeader?.('content-type', 'application/json; charset=utf-8')
  }
  res.end(JSON.stringify(payload))
}

export default async function handler(req, res, deps = {}) {
  res.setHeader?.('access-control-allow-origin', req.headers?.origin || '*')
  res.setHeader?.('access-control-allow-methods', 'GET, POST, OPTIONS')
  res.setHeader?.('access-control-allow-headers', 'accept, content-type')
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  try {
    let body = req.query || {}
    if (req.method === 'POST') {
      body = await readJsonBody(req)
    } else if (!Object.keys(body).length && req.url) {
      const parsedReqUrl = new URL(req.url, `http://${req.headers?.host || 'localhost'}`)
      body = Object.fromEntries(parsedReqUrl.searchParams.entries())
    }

    const rawSourceUrl = String(body.sourceUrl || body.url || '').trim()
    const rawText = String(body.text || '').trim()
    const customName = String(body.name || '').trim()
    const hintTitle = String(body.hintTitle || body.title || '').trim()
    const fetchImpl = deps.fetchImpl || globalThis.fetch

    let imported = null
    if (rawSourceUrl) {
      const unwrappedUrl = await unwrapRedirectIfNeeded(rawSourceUrl, fetchImpl)
      let parsedUrl = null
      try {
        parsedUrl = new URL(unwrappedUrl)
      } catch {
        sendJson(res, 400, { success: false, message: 'Enter a valid song or playlist URL.' })
        return
      }
      const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, '')
      const path = parsedUrl.pathname || '/'

      // Extract YouTube single video ID (`watch?v=...`, `youtu.be/...`, `/shorts/...`) BEFORE `?list=...`!
      let ytVideoId = ''
      if (host === 'youtu.be') {
        ytVideoId = path.split('/').filter(Boolean)[0] || ''
      } else if (path === '/watch') {
        ytVideoId = parsedUrl.searchParams.get('v') || ''
      } else {
        const seg = /^\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/i.exec(path)
        if (seg) ytVideoId = seg[1]
      }
      const ytBrowse = /^\/browse\/(MPREb_[A-Za-z0-9_-]+|VL[A-Za-z0-9_-]+)/i.exec(path)
      const ytList = ytBrowse ? ytBrowse[1] : parsedUrl.searchParams.get('list')
      const spotifyEntity =
        /\/(?:intl-[a-z-]+|embed|user\/[^/]+)?\/?(track|album|playlist|artist)\/([A-Za-z0-9]{15,32})/i.exec(
          path
        )

      if (host === 'jiosaavn.com' || host === 'saavn.com') {
        imported = await importFromJioSaavnUrl(unwrappedUrl, deps.fetchImpl || null)
      } else if (
        /^[A-Za-z0-9_-]{11}$/.test(ytVideoId) &&
        path !== '/playlist' &&
        (host.includes('youtube.com') || host === 'youtu.be' || host.includes('youtube-nocookie.com'))
      ) {
        imported = await importSingleYouTubeVideo(ytVideoId, hintTitle, fetchImpl)
      } else if (ytList && (host.includes('youtube.com') || host === 'youtu.be')) {
        imported = await importFromYouTubePlaylist(ytList, fetchImpl)
      } else if (spotifyEntity && host.includes('spotify.com')) {
        imported = await importFromSpotifyEntity(
          spotifyEntity[1].toLowerCase(),
          spotifyEntity[2],
          hintTitle,
          fetchImpl
        )
      } else if (host.includes('apple.com')) {
        imported = await importFromAppleMusicUrl(unwrappedUrl, hintTitle, fetchImpl)
      } else {
        sendJson(res, 400, {
          success: false,
          message:
            'Supported links: YouTube / YT Music, Spotify (song, album, playlist, artist), JioSaavn, or Apple Music.',
        })
        return
      }
    } else if (rawText) {
      const entries = parseTextTracklist(rawText)
      if (!entries.length) {
        sendJson(res, 400, { success: false, message: 'Paste at least one song link or "Artist - Song" line.' })
        return
      }
      const tracks = await resolveTextQueriesToSaavn(entries, deps.fetchImpl || null)
      imported = {
        kind: entries.length === 1 ? 'track' : 'collection',
        name: customName || (entries.length === 1 ? entries[0].query : 'Imported Tracklist'),
        sourceType: 'text',
        requestedCount: entries.length,
        tracks,
      }
    } else {
      sendJson(res, 400, { success: false, message: 'Provide a song/playlist link or text tracklist.' })
      return
    }

    if (customName) imported.name = customName

    sendJson(res, 200, {
      success: true,
      data: {
        kind: imported.kind || (imported.tracks.length === 1 ? 'track' : 'collection'),
        name: imported.name,
        source: imported.sourceType,
        sourceType: imported.sourceType,
        requestedCount: imported.requestedCount || imported.tracks.length,
        matchedCount: imported.tracks.length,
        totalFound: imported.tracks.length,
        tracks: imported.tracks,
      },
    })
  } catch (err) {
    sendJson(res, 422, {
      success: false,
      message: err?.message || 'Share / playlist resolution failed.',
    })
  }
}
