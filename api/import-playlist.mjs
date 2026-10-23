/**
 * /api/import-playlist  --  Universal Playlist & Tracklist Importer.
 *
 * Accepts:
 *  - JioSaavn playlist / album URLs (`https://www.jiosaavn.com/s/playlist/...`, `/featured/...`, `/album/...`)
 *  - YouTube / YouTube Music playlist URLs (`?list=PL...` / `music.youtube.com/playlist?list=...`)
 *  - Spotify public playlist URLs (`https://open.spotify.com/playlist/<id>` via public embed JSON)
 *  - Plain pasted text tracklists (`1. Artist - Song`, `Song — Artist`, etc.)
 *
 * Resolves every entry into playable VIBEX song objects backed by 320kbps studio
 * streams where available (falling back cleanly to YouTube audio entries).
 */

import saavnApp from '../jiosaavn-api/src/server.js'
import { enrichResultsWithSaavnAudio, listItemRenderers, toResult } from './ytmusic.mjs'
import { unescapeEntities } from './_lib/trackMatch.mjs'

const MAX_IMPORT_TRACKS = 100
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

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

async function importFromJioSaavnUrl(sourceUrl) {
  const isAlbum = /\/album\//i.test(sourceUrl)
  const endpoint = isAlbum
    ? `/albums?link=${encodeURIComponent(sourceUrl)}`
    : `/playlists?link=${encodeURIComponent(sourceUrl)}&limit=${MAX_IMPORT_TRACKS}`
  const data = await callSaavn(endpoint)
  if (!data?.songs?.length) {
    throw new Error('Could not find playable songs at that JioSaavn link.')
  }
  return {
    name: unescapeEntities(data.name || 'Imported JioSaavn Playlist'),
    sourceType: 'jiosaavn',
    tracks: data.songs.slice(0, MAX_IMPORT_TRACKS),
  }
}

async function importFromYouTubePlaylist(listId, fetchImpl = fetch) {
  const browseId = listId.startsWith('VL') ? listId : `VL${listId}`
  const res = await fetchImpl('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': UA,
      origin: 'https://music.youtube.com',
    },
    body: JSON.stringify({
      context: {
        client: { clientName: 'WEB_REMIX', clientVersion: '1.20241118.01.00', hl: 'en', gl: 'IN' },
      },
      browseId,
    }),
    signal: AbortSignal.timeout(9000),
  })
  if (!res.ok) throw new Error(`YouTube playlist lookup failed (${res.status}).`)
  const json = await res.json()

  const titleMatch =
    json?.header?.musicResponsiveHeaderRenderer?.title?.runs?.[0]?.text ||
    json?.header?.musicDetailHeaderRenderer?.title?.runs?.[0]?.text ||
    'Imported YouTube Playlist'

  const rawItems = []
  const seen = new Set()
  for (const renderer of listItemRenderers(json)) {
    const item = toResult(renderer)
    if (!item || seen.has(item.videoId)) continue
    seen.add(item.videoId)
    rawItems.push(item)
    if (rawItems.length >= MAX_IMPORT_TRACKS) break
  }

  if (!rawItems.length) {
    throw new Error('No public tracks found in that YouTube playlist (make sure it is Public or Unlisted).')
  }

  const enriched = await enrichResultsWithSaavnAudio(rawItems)
  const tracks = enriched.map((item) => {
    const matched = item.matchedAudio
    const thumb = item.thumbnail || ''
    return {
      id: `yt:${item.videoId}`,
      videoId: item.videoId,
      source: 'ytmusic',
      name: item.title,
      subtitle: item.subtitle || '',
      duration: matched?.duration || item.duration || 0,
      album: matched?.album || (item.album ? { id: null, name: item.album, url: null } : null),
      artists: {
        primary: (item.artists || []).map((n) => ({ id: null, name: n, role: 'primary_artists' })),
        featured: [],
        all: [],
      },
      image: thumb
        ? [
            { quality: '50x50', url: thumb },
            { quality: '150x150', url: thumb },
            { quality: '500x500', url: thumb },
          ]
        : matched?.image || [],
      downloadUrl: matched?.downloadUrl || [],
      ...(matched?.songId ? { _matchedSaavnId: matched.songId } : {}),
    }
  })

  return {
    name: unescapeEntities(titleMatch),
    sourceType: 'youtube',
    tracks,
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
        `/search/songs?query=${encodeURIComponent(entry.query)}&limit=3`,
        fetchImpl
      ).catch(() => null)
      const hit = d?.results?.[0]
      if (hit?.id && hit?.downloadUrl?.length) out[idx] = hit
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, entries.length) }, () => worker()))
  return out.filter(Boolean)
}

async function importFromSpotifyPlaylist(playlistId, fetchImpl = fetch) {
  const embedRes = await fetchImpl(`https://open.spotify.com/embed/playlist/${encodeURIComponent(playlistId)}`, {
    headers: { 'user-agent': UA, accept: 'text/html' },
    signal: AbortSignal.timeout(9000),
  })
  if (!embedRes.ok) throw new Error('Could not read that Spotify playlist.')
  const html = await embedRes.text()
  const nextDataMatch = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html)
  if (!nextDataMatch) throw new Error('Spotify playlist metadata unavailable — paste its tracklist text instead.')

  const parsed = JSON.parse(nextDataMatch[1])
  const entity = parsed?.props?.pageProps?.state?.data?.entity
  const trackList = entity?.trackList || []
  if (!trackList.length) throw new Error('No tracks found in that Spotify playlist.')

  const entries = trackList.slice(0, MAX_IMPORT_TRACKS).map((t) => ({
    artist: t.subtitle || '',
    title: t.title || '',
    query: `${t.title || ''} ${t.subtitle || ''}`.trim(),
  }))
  const tracks = await resolveTextQueriesToSaavn(entries)
  return {
    name: unescapeEntities(entity?.name || entity?.title || 'Imported Spotify Playlist'),
    sourceType: 'spotify',
    tracks,
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
    const body = req.method === 'POST' ? await readJsonBody(req) : req.query || {}
    const sourceUrl = String(body.sourceUrl || body.url || '').trim()
    const rawText = String(body.text || '').trim()
    const customName = String(body.name || '').trim()
    const fetchImpl = deps.fetchImpl || globalThis.fetch

    let imported = null
    if (sourceUrl) {
      let parsedUrl = null
      try {
        parsedUrl = new URL(sourceUrl)
      } catch {
        sendJson(res, 400, { success: false, message: 'Enter a valid playlist URL or paste a tracklist.' })
        return
      }
      const host = parsedUrl.hostname.toLowerCase()
      const ytList = parsedUrl.searchParams.get('list')
      const spotifyMatch = /\/playlist\/([A-Za-z0-9]+)/i.exec(parsedUrl.pathname)

      if (host.includes('jiosaavn.com') || host.includes('saavn.com')) {
        imported = await importFromJioSaavnUrl(sourceUrl)
      } else if (ytList && (host.includes('youtube.com') || host.includes('youtu.be'))) {
        imported = await importFromYouTubePlaylist(ytList, fetchImpl)
      } else if (spotifyMatch && host.includes('spotify.com')) {
        imported = await importFromSpotifyPlaylist(spotifyMatch[1], fetchImpl)
      } else {
        sendJson(res, 400, {
          success: false,
          message: 'Supported URLs: JioSaavn playlist/album, YouTube playlist (?list=...), or Spotify playlist.',
        })
        return
      }
    } else if (rawText) {
      const entries = parseTextTracklist(rawText)
      if (!entries.length) {
        sendJson(res, 400, { success: false, message: 'Paste at least one "Artist - Song" line.' })
        return
      }
      const tracks = await resolveTextQueriesToSaavn(entries, deps.fetchImpl || null)
      imported = {
        name: customName || 'Imported Tracklist',
        sourceType: 'text',
        requestedCount: entries.length,
        tracks,
      }
    } else {
      sendJson(res, 400, { success: false, message: 'Provide a playlist URL or a text tracklist.' })
      return
    }

    if (customName) imported.name = customName

    sendJson(res, 200, {
      success: true,
      data: {
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
      message: err?.message || 'Playlist import failed.',
    })
  }
}
