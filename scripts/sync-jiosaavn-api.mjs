#!/usr/bin/env node
/**
 * Sync & compile upstream `https://github.com/sumitkolhe/jiosaavn-api.git`
 * directly into `jiosaavn-api/src/` as pure ESM JavaScript, then apply VIBEX's
 * live catalog extensions (`content/trending`, `content/new-releases`,
 * `content/albums`, `content/sync-status`, `resolveFeedAlias`) and upstream
 * stability fixes (User-Agent rotation, `Cookie: L=...`, safe JSON parsing on
 * artists, safe suggestion mapping, playlist song fallback, and fresh Edge SWR
 * `Cache-Control` headers).
 *
 * Run manually with:
 *   node scripts/sync-jiosaavn-api.mjs
 * or automatically every 6 hours via `.github/workflows/sync-jiosaavn-api.yml`.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from '../music-app/node_modules/esbuild/lib/main.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const TARGET_ROOT = path.join(REPO_ROOT, 'jiosaavn-api')
const TARGET_SRC = path.join(TARGET_ROOT, 'src')
const UPSTREAM_REPO = 'https://github.com/sumitkolhe/jiosaavn-api.git'
const UPSTREAM_BRANCH = 'main'

function parseArgs(argv) {
  const out = { sourceDir: null }
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--source' && argv[i + 1]) {
      out.sourceDir = path.resolve(argv[++i])
    }
  }
  return out
}

function walkFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, acc)
    else acc.push(full)
  }
  return acc
}

function toPosixRelative(fromDir, toFile) {
  let rel = path.relative(fromDir, toFile).split(path.sep).join('/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel
}

function resolveCompiledTarget(targetBase) {
  if (fs.existsSync(`${targetBase}.js`)) return `${targetBase}.js`
  if (fs.existsSync(path.join(targetBase, 'index.js'))) return path.join(targetBase, 'index.js')
  if (targetBase.endsWith('.js') && fs.existsSync(targetBase)) return targetBase
  return `${targetBase}/index.js`
}

function rewriteImportsInDir(rootSrc) {
  for (const file of walkFiles(rootSrc)) {
    if (!file.endsWith('.js')) continue
    const fromDir = path.dirname(file)
    const raw = fs.readFileSync(file, 'utf8')
    const rewritten = raw.replace(
      /(from\s+['"]|import\s*\(\s*['"])([^'"]+)(['"])/g,
      (full, prefix, spec, quote) => {
        if (spec.startsWith('#common/')) {
          const sub = spec.slice('#common/'.length)
          const resolved = resolveCompiledTarget(path.join(rootSrc, 'common', sub))
          return `${prefix}${toPosixRelative(fromDir, resolved)}${quote}`
        }
        if (spec.startsWith('#modules/')) {
          const sub = spec.slice('#modules/'.length)
          const resolved = resolveCompiledTarget(path.join(rootSrc, 'modules', sub))
          return `${prefix}${toPosixRelative(fromDir, resolved)}${quote}`
        }
        if (spec.startsWith('./') || spec.startsWith('../')) {
          if (/\.(?:m?js|json)$/i.test(spec)) return full
          const candidate = resolveCompiledTarget(path.resolve(fromDir, spec))
          return `${prefix}${toPosixRelative(fromDir, candidate)}${quote}`
        }
        return full
      }
    )
    if (rewritten !== raw) fs.writeFileSync(file, rewritten, 'utf8')
  }
}

function applyEnhancements(targetRoot, upstreamMeta) {
  const src = path.join(targetRoot, 'src')

  // 1. Upstream sync metadata manifest
  fs.writeFileSync(
    path.join(targetRoot, 'upstream.json'),
    JSON.stringify(upstreamMeta, null, 2) + '\n',
    'utf8'
  )

  // 2. Endpoints constant (upstream + topSearches & charts)
  fs.writeFileSync(
    path.join(src, 'common/constants/endpoint.constant.js'),
    `export const Endpoints = {
  search: {
    all: 'autocomplete.get',
    songs: 'search.getResults',
    albums: 'search.getAlbumResults',
    artists: 'search.getArtistResults',
    playlists: 'search.getPlaylistResults'
  },
  songs: {
    id: 'song.getDetails',
    link: 'webapi.get',
    suggestions: 'webradio.getSong',
    lyrics: 'lyrics.getLyrics',
    station: 'webradio.createEntityStation'
  },
  albums: {
    id: 'content.getAlbumDetails',
    link: 'webapi.get'
  },
  artists: {
    id: 'artist.getArtistPageDetails',
    link: 'webapi.get',
    songs: 'artist.getArtistMoreSong',
    albums: 'artist.getArtistMoreAlbum'
  },
  playlists: {
    id: 'playlist.getDetails',
    link: 'webapi.get'
  },
  modules: 'content.getBrowseModules',
  trending: 'content.getTrending',
  charts: 'content.getCharts',
  topSearches: 'content.getTopSearches'
}
`,
    'utf8'
  )

  // 3. Modern rotated browser User-Agents (drops legacy Chrome 58/79/89 strings flagged by WAF)
  const uaFile = path.join(src, 'common/constants/user-agents.constant.js')
  const uaRaw = fs.readFileSync(uaFile, 'utf8')
  if (!uaRaw.includes('Chrome/141.0.0.0')) {
    const freshAgents = [
      "  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',",
      "  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',",
      "  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',",
      "  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0',",
      "  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',",
    ].join('\n')
    fs.writeFileSync(
      uaFile,
      uaRaw
        .replace('export const userAgents = [', `export const userAgents = [\n${freshAgents}`)
        .replace(/.*Chrome\/(?:58|79|89|91)\..*\n/g, ''),
      'utf8'
    )
  }

  // 4. Fresh Edge SWR Cache-Control helper + hardened fetch helper (Cookie + retry + clean errors)
  fs.writeFileSync(
    path.join(src, 'common/helpers/cache.helper.js'),
    `const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const STALE_IF_ERROR = \`stale-if-error=\${7 * DAY}\`

const cacheable = (maxAge, sMaxAge, revalidate) =>
  \`public, max-age=\${maxAge}, s-maxage=\${sMaxAge}, stale-while-revalidate=\${revalidate}, \${STALE_IF_ERROR}\`

const RULES = [
  [/^\\/api\\/(content|trending|new-releases|modules|charts)(\\/|$)/, cacheable(3 * MINUTE, 5 * MINUTE, 15 * MINUTE)],
  [/^\\/api\\/songs\\/[^/]+\\/suggestions\\/?$/, cacheable(5 * MINUTE, 10 * MINUTE, 30 * MINUTE)],
  [/^\\/api\\/search(\\/|$)/, cacheable(3 * MINUTE, 5 * MINUTE, 15 * MINUTE)],
  [/^\\/api\\/(songs|artists|albums|playlists)(\\/|$)/, cacheable(15 * MINUTE, 30 * MINUTE, 2 * HOUR)]
]

export const cacheControlFor = (pathname) => {
  for (const [pattern, value] of RULES) {
    if (pattern.test(pathname)) return value
  }
  return 'no-store'
}
`,
    'utf8'
  )

  fs.writeFileSync(
    path.join(src, 'common/helpers/fetch.helper.js'),
    `import { userAgents } from '../constants/index.js'

const pickUserAgent = () => userAgents[Math.floor(Math.random() * userAgents.length)]

export const useFetch = async ({ endpoint, params, context, cookie }) => {
  const url = new URL('https://www.jiosaavn.com/api.php')
  url.searchParams.append('__call', endpoint.toString())
  url.searchParams.append('_format', 'json')
  url.searchParams.append('_marker', '0')
  url.searchParams.append('api_version', '4')
  url.searchParams.append('ctx', context || 'web6dot0')
  Object.keys(params || {}).forEach((key) => {
    if (params[key] !== undefined && params[key] !== null) {
      url.searchParams.append(key, String(params[key]))
    }
  })

  const headers = {
    Accept: 'application/json',
    'User-Agent': pickUserAgent(),
    ...(cookie ? { Cookie: cookie } : {})
  }

  let response = await fetch(url.toString(), {
    headers,
    signal: AbortSignal.timeout(15000)
  })

  if (response && !response.ok && (response.status === 403 || response.status === 429 || response.status >= 500)) {
    // Rotate User-Agent once when JioSaavn's edge rate-limits a single request.
    try {
      const retryHeaders = { ...headers, 'User-Agent': pickUserAgent() }
      const retryResponse = await fetch(url.toString(), {
        headers: retryHeaders,
        signal: AbortSignal.timeout(15000)
      })
      if (retryResponse) response = retryResponse
    } catch {
      // Keep original response so error handling stays deterministic.
    }
  }

  if (!response?.ok) {
    return { data: null, ok: false, status: response?.status || 502 }
  }

  const data = await response.json().catch(() => null)
  return { data, ok: Boolean(data), status: response.status }
}
`,
    'utf8'
  )

  fs.writeFileSync(
    path.join(src, 'common/helpers/index.js'),
    `export * from './fetch.helper.js'
export * from './link.helper.js'
export * from './cache.helper.js'
`,
    'utf8'
  )

  // 5. Fix Artist JSON.parse crashes (upstream issues #166 & #182)
  fs.writeFileSync(
    path.join(src, 'modules/artists/helpers/artist.helper.js'),
    `import { createImageLinks } from '../../../common/helpers/index.js'
import { createAlbumPayload } from '../../albums/helpers/index.js'
import { createSongPayload } from '../../songs/helpers/index.js'

const safeJsonParse = (value) => {
  if (!value) return null
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export const createArtistPayload = (artist) => ({
  id: artist.artistId || artist.id,
  name: artist.name,
  url: artist.urls?.overview || artist.perma_url,
  type: artist.type,
  followerCount: artist.follower_count ? Number(artist.follower_count) : null,
  fanCount: artist.fan_count || null,
  isVerified: artist.isVerified || null,
  dominantLanguage: artist.dominantLanguage || null,
  dominantType: artist.dominantType || null,
  bio: safeJsonParse(artist.bio),
  dob: artist.dob || null,
  fb: artist.fb || null,
  twitter: artist.twitter || null,
  wiki: artist.wiki || null,
  availableLanguages: artist.availableLanguages || null,
  isRadioPresent: artist.isRadioPresent || null,
  image: createImageLinks(artist.image),
  topSongs: artist.topSongs?.map(createSongPayload) || null,
  topAlbums: artist.topAlbums?.map(createAlbumPayload) || null,
  singles: artist.singles?.map(createSongPayload) || null,
  similarArtists:
    artist.similarArtists?.map((similarArtist) => ({
      id: similarArtist.id,
      name: similarArtist.name,
      url: similarArtist.perma_url,
      image: createImageLinks(similarArtist.image_url),
      languages: safeJsonParse(similarArtist.languages),
      wiki: similarArtist.wiki,
      dob: similarArtist.dob,
      fb: similarArtist.fb,
      twitter: similarArtist.twitter,
      isRadioPresent: similarArtist.isRadioPresent,
      type: similarArtist.type,
      dominantType: similarArtist.dominantType,
      aka: similarArtist.aka,
      bio: safeJsonParse(similarArtist.bio),
      similarArtists: safeJsonParse(similarArtist.similar)
    })) || null
})

export const createArtistMapPayload = (artist) => ({
  id: artist.id,
  name: artist.name,
  role: artist.role,
  image: createImageLinks(artist.image),
  type: artist.type,
  url: artist.perma_url
})
`,
    'utf8'
  )

  // 6. Fix Song Suggestions crash when non-song metadata keys exist (upstream issues #157 & #180)
  fs.writeFileSync(
    path.join(src, 'modules/songs/use-cases/get-song-suggestions/get-song-suggestions.use-case.js'),
    `import { Endpoints } from '../../../../common/constants/index.js'
import { ApiContextEnum } from '../../../../common/enums/index.js'
import { useFetch } from '../../../../common/helpers/index.js'
import { createSongPayload } from '../../../songs/helpers/index.js'
import { CreateSongStationUseCase } from '../../../songs/use-cases/index.js'
import { HTTPException } from 'hono/http-exception'

export class GetSongSuggestionsUseCase {
  createSongStation
  constructor() {
    this.createSongStation = new CreateSongStationUseCase()
  }
  async execute({ songId, limit }) {
    const stationId = await this.createSongStation.execute(songId)
    const { data, ok } = await useFetch({
      endpoint: Endpoints.songs.suggestions,
      params: {
        stationid: stationId,
        k: limit
      },
      context: ApiContextEnum.ANDROID
    })
    if (!data || !ok) {
      throw new HTTPException(404, { message: 'no suggestions found for the given song' })
    }
    const { stationid, ...suggestions } = data
    return (
      Object.values(suggestions)
        .filter((element) => element && typeof element === 'object' && element.song?.id)
        .map((element) => createSongPayload(element.song))
        .slice(0, limit) || []
    )
  }
}
`,
    'utf8'
  )

  // 7. Fix Playlist songs array when JioSaavn places tracks in `more_info.songs` (upstream issue #155)
  fs.writeFileSync(
    path.join(src, 'modules/playlists/helpers/playlist.helper.js'),
    `import { createImageLinks } from '../../../common/helpers/index.js'
import { createArtistMapPayload } from '../../artists/helpers/index.js'
import { createSongPayload } from '../../songs/helpers/index.js'

export const createPlaylistPayload = (playlist) => {
  const rawSongs =
    Array.isArray(playlist.list) && playlist.list.length
      ? playlist.list
      : Array.isArray(playlist.more_info?.songs) && playlist.more_info.songs.length
        ? playlist.more_info.songs
        : Array.isArray(playlist.list)
          ? playlist.list
          : null

  return {
    id: playlist.id,
    name: playlist.title,
    description: playlist.header_desc,
    type: playlist.type,
    year: playlist.year ? Number(playlist.year) : null,
    playCount: playlist.play_count ? Number(playlist.play_count) : null,
    language: playlist.language,
    explicitContent: playlist.explicit_content === '1',
    url: playlist.perma_url,
    songCount: playlist.list_count ? Number(playlist.list_count) : null,
    artists: playlist.more_info?.artists?.map(createArtistMapPayload) || null,
    image: createImageLinks(playlist.image),
    songs: rawSongs ? rawSongs.filter((song) => song && song.id).map(createSongPayload) : null
  }
}
`,
    'utf8'
  )

  // 8. Live Content Module (`trending`, `new-releases`, `albums`, `sync-status`) + Feed Aliases
  const contentDir = path.join(src, 'modules/content')
  fs.mkdirSync(path.join(contentDir, 'helpers'), { recursive: true })
  fs.mkdirSync(path.join(contentDir, 'use-cases'), { recursive: true })
  fs.mkdirSync(path.join(contentDir, 'services'), { recursive: true })
  fs.mkdirSync(path.join(contentDir, 'controllers'), { recursive: true })

  fs.writeFileSync(
    path.join(contentDir, 'helpers/feed.helper.js'),
    `export const SUPPORTED_LANGUAGES = [
  'english',
  'hindi',
  'tamil',
  'telugu',
  'malayalam',
  'kannada',
  'punjabi',
  'bengali',
  'marathi',
  'gujarati',
  'bhojpuri',
  'urdu'
]

export const DEFAULT_FEED_LANGUAGES = ['tamil', 'hindi', 'english', 'telugu', 'malayalam']

export const parseLanguages = (languagesParam, fallback = DEFAULT_FEED_LANGUAGES) => {
  const requested = String(languagesParam || '')
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter((l) => SUPPORTED_LANGUAGES.includes(l))
  return requested.length ? [...new Set(requested)] : [...fallback]
}

export const sortFeedSongs = (songs, sort = 'trending') => {
  const ordered = [...songs]
  if (sort === 'trending') return ordered
  if (sort === 'newest') {
    return ordered.sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
  }
  return ordered.sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0))
}

export const interleaveFeedItems = (lists, limit = 20) => {
  const seen = new Set()
  const merged = []
  const longest = Math.max(0, ...lists.map((list) => list.length))
  for (let index = 0; index < longest && merged.length < limit; index++) {
    for (const list of lists) {
      if (merged.length >= limit) break
      const item = list[index]
      if (!item || !item.id || seen.has(item.id)) continue
      seen.add(item.id)
      merged.push(item)
    }
  }
  return merged
}

export const interleaveFeedSongs = interleaveFeedItems
`,
    'utf8'
  )

  fs.writeFileSync(
    path.join(contentDir, 'helpers/index.js'),
    `export * from './feed.helper.js'\n`,
    'utf8'
  )

  fs.writeFileSync(
    path.join(contentDir, 'use-cases/get-trending-songs.use-case.js'),
    `import { Endpoints } from '../../../common/constants/index.js'
import { useFetch } from '../../../common/helpers/index.js'
import { createSongPayload } from '../../songs/helpers/index.js'
import { interleaveFeedSongs, parseLanguages, sortFeedSongs } from '../helpers/index.js'

export class GetTrendingSongsUseCase {
  async execute({ languages, sort = 'trending', limit = 20 } = {}) {
    const langs = Array.isArray(languages) ? languages : parseLanguages(languages)
    const settled = await Promise.allSettled(langs.map((language) => this.fetchLanguage(language)))
    const lists = settled
      .filter((r) => r.status === 'fulfilled' && r.value.length > 0)
      .map((r) => sortFeedSongs(r.value, sort))
    return interleaveFeedSongs(lists, limit)
  }

  async fetchLanguage(language) {
    const { data, ok } = await useFetch({
      endpoint: Endpoints.trending,
      params: { entity_type: 'song', entity_language: language },
      cookie: \`L=\${language}\`
    })
    const items = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : []
    if (!ok || !items.length) return []
    return items
      .filter((song) => song?.id && song?.more_info?.encrypted_media_url)
      .map(createSongPayload)
  }
}
`,
    'utf8'
  )

  fs.writeFileSync(
    path.join(contentDir, 'use-cases/get-new-releases.use-case.js'),
    `import { Endpoints } from '../../../common/constants/index.js'
import { useFetch } from '../../../common/helpers/index.js'
import { createSongPayload } from '../../songs/helpers/index.js'
import { interleaveFeedSongs, parseLanguages, sortFeedSongs } from '../helpers/index.js'
import { GetTrendingSongsUseCase } from './get-trending-songs.use-case.js'

export class GetNewReleasesUseCase {
  trendingFallback

  constructor() {
    this.trendingFallback = new GetTrendingSongsUseCase()
  }

  async execute({ languages, limit = 20 } = {}) {
    const langs = Array.isArray(languages) ? languages : parseLanguages(languages)
    const settled = await Promise.allSettled(langs.map((language) => this.fetchLanguage(language)))
    const lists = settled
      .filter((r) => r.status === 'fulfilled' && r.value.length > 0)
      .map((r) => sortFeedSongs(r.value, 'newest'))

    const merged = interleaveFeedSongs(lists, limit)
    if (merged.length >= Math.min(limit, 6)) return merged

    // Supplement with newest-sorted live trending songs if browse modules have mostly albums.
    const extra = await this.trendingFallback.execute({ languages: langs, sort: 'newest', limit })
    return interleaveFeedSongs([merged, extra], limit)
  }

  async fetchLanguage(language) {
    const { data, ok } = await useFetch({
      endpoint: Endpoints.modules,
      params: {},
      cookie: \`L=\${language}\`
    })
    if (!ok || !data) return []
    const candidates = [
      ...(Array.isArray(data.new_albums) ? data.new_albums : []),
      ...(Array.isArray(data.new_trending) ? data.new_trending : [])
    ]
    return candidates
      .filter((entry) => entry?.type === 'song' && entry?.id && entry?.more_info?.encrypted_media_url)
      .map(createSongPayload)
  }
}
`,
    'utf8'
  )

  fs.writeFileSync(
    path.join(contentDir, 'use-cases/get-new-albums.use-case.js'),
    `import { Endpoints } from '../../../common/constants/index.js'
import { useFetch } from '../../../common/helpers/index.js'
import { createAlbumPayload } from '../../albums/helpers/index.js'
import { interleaveFeedItems, parseLanguages } from '../helpers/index.js'

export class GetNewAlbumsUseCase {
  async execute({ languages, limit = 20 } = {}) {
    const langs = Array.isArray(languages) ? languages : parseLanguages(languages)
    const settled = await Promise.allSettled(langs.map((language) => this.fetchLanguage(language)))
    const lists = settled
      .filter((r) => r.status === 'fulfilled' && r.value.length > 0)
      .map((r) => r.value)
    return interleaveFeedItems(lists, limit)
  }

  async fetchLanguage(language) {
    const [browseRes, trendingRes] = await Promise.allSettled([
      useFetch({ endpoint: Endpoints.modules, params: {}, cookie: \`L=\${language}\` }),
      useFetch({
        endpoint: Endpoints.trending,
        params: { entity_type: 'album', entity_language: language },
        cookie: \`L=\${language}\`
      })
    ])
    const raw = []
    if (browseRes.status === 'fulfilled' && browseRes.value.ok) {
      const mod = browseRes.value.data
      if (Array.isArray(mod?.new_albums)) {
        raw.push(...mod.new_albums.filter((item) => item?.type === 'album' && item?.id))
      }
    }
    if (trendingRes.status === 'fulfilled' && trendingRes.value.ok && Array.isArray(trendingRes.value.data)) {
      raw.push(...trendingRes.value.data.filter((item) => item?.id))
    }
    return raw.map(createAlbumPayload)
  }
}
`,
    'utf8'
  )

  fs.writeFileSync(
    path.join(contentDir, 'use-cases/index.js'),
    `export * from './get-trending-songs.use-case.js'
export * from './get-new-releases.use-case.js'
export * from './get-new-albums.use-case.js'
`,
    'utf8'
  )

  fs.writeFileSync(
    path.join(contentDir, 'services/content.service.js'),
    `import {
  GetNewAlbumsUseCase,
  GetNewReleasesUseCase,
  GetTrendingSongsUseCase
} from '../use-cases/index.js'

export class ContentService {
  trendingSongs = new GetTrendingSongsUseCase()
  newReleases = new GetNewReleasesUseCase()
  newAlbums = new GetNewAlbumsUseCase()

  getTrendingSongs(args) {
    return this.trendingSongs.execute(args)
  }

  getNewReleases(args) {
    return this.newReleases.execute(args)
  }

  getNewAlbums(args) {
    return this.newAlbums.execute(args)
  }
}
`,
    'utf8'
  )

  fs.writeFileSync(
    path.join(contentDir, 'services/index.js'),
    `export * from './content.service.js'\n`,
    'utf8'
  )

  fs.writeFileSync(
    path.join(contentDir, 'controllers/content.controller.js'),
    `import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { ContentService } from '../services/index.js'

const UPSTREAM_SYNC = ${JSON.stringify(upstreamMeta)}

const feedQuerySchema = z.object({
  languages: z.string().optional(),
  sort: z.enum(['trending', 'plays', 'newest']).optional(),
  limit: z.string().pipe(z.coerce.number().min(1).max(60)).optional()
})

export class ContentController {
  controller
  service

  constructor() {
    this.controller = new OpenAPIHono()
    this.service = new ContentService()
  }

  initRoutes() {
    const trendingHandler = async (ctx) => {
      const { languages, sort, limit } = ctx.req.valid('query')
      const results = await this.service.getTrendingSongs({
        languages,
        sort: sort || 'trending',
        limit: limit || 20
      })
      return ctx.json({
        success: true,
        data: {
          total: results.length,
          start: 0,
          updatedAt: new Date().toISOString(),
          results
        }
      })
    }

    const newReleasesHandler = async (ctx) => {
      const { languages, limit } = ctx.req.valid('query')
      const results = await this.service.getNewReleases({
        languages,
        limit: limit || 20
      })
      return ctx.json({
        success: true,
        data: {
          total: results.length,
          start: 0,
          updatedAt: new Date().toISOString(),
          results
        }
      })
    }

    for (const routePath of ['/content/trending', '/trending']) {
      this.controller.openapi(
        createRoute({
          method: 'get',
          path: routePath,
          tags: ['Content'],
          summary: 'Retrieve live trending songs across languages',
          request: { query: feedQuerySchema },
          responses: {
            200: {
              description: 'Live trending songs with decrypted audio URLs',
              content: { 'application/json': { schema: z.any() } }
            }
          }
        }),
        trendingHandler
      )
    }

    for (const routePath of ['/content/new-releases', '/new-releases']) {
      this.controller.openapi(
        createRoute({
          method: 'get',
          path: routePath,
          tags: ['Content'],
          summary: 'Retrieve newly released playable songs across languages',
          request: { query: feedQuerySchema },
          responses: {
            200: {
              description: 'Newly released playable songs sorted by releaseDate descending',
              content: { 'application/json': { schema: z.any() } }
            }
          }
        }),
        newReleasesHandler
      )
    }

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/content/albums',
        tags: ['Content'],
        summary: 'Retrieve newly released and trending albums across languages',
        request: { query: feedQuerySchema },
        responses: {
          200: {
            description: 'Live trending and newly released albums',
            content: { 'application/json': { schema: z.any() } }
          }
        }
      }),
      async (ctx) => {
        const { languages, limit } = ctx.req.valid('query')
        const results = await this.service.getNewAlbums({
          languages,
          limit: limit || 20
        })
        return ctx.json({
          success: true,
          data: {
            total: results.length,
            start: 0,
            updatedAt: new Date().toISOString(),
            results
          }
        })
      }
    )

    for (const statusPath of ['/content/sync-status', '/health']) {
      this.controller.get(statusPath, (ctx) =>
        ctx.json({
          success: true,
          data: {
            status: 'ok',
            upstream: UPSTREAM_SYNC,
            refreshPolicy: {
              catalogTtlSeconds: 180,
              edgeSMaxAgeSeconds: 300,
              scheduledRepoSyncCron: '0 */6 * * *'
            }
          }
        })
      )
    }
  }
}
`,
    'utf8'
  )

  fs.writeFileSync(
    path.join(contentDir, 'controllers/index.js'),
    `export * from './content.controller.js'\n`,
    'utf8'
  )

  fs.writeFileSync(
    path.join(contentDir, 'index.js'),
    `export * from './controllers/index.js'
export * from './services/index.js'
export * from './use-cases/index.js'
export * from './helpers/index.js'
`,
    'utf8'
  )

  // 9. Feed-alias support on `/api/search/songs` (`trending songs <year>`, `new <lang> songs <year>`, `<lang> hits <year>`)
  fs.writeFileSync(
    path.join(src, 'modules/search/helpers/feed-alias.helper.js'),
    `import { DEFAULT_FEED_LANGUAGES, SUPPORTED_LANGUAGES, parseLanguages } from '../../content/helpers/index.js'

export { DEFAULT_FEED_LANGUAGES as DEFAULT_TRENDING_LANGUAGES, SUPPORTED_LANGUAGES }

const LANGUAGE_GROUP = SUPPORTED_LANGUAGES.join('|')
const TRENDING_PATTERN = /^trending songs \\d{4}$/
const NEW_PATTERN = new RegExp(\`^new (\${LANGUAGE_GROUP}) songs \\\\d{4}$\`)
const HITS_PATTERN = new RegExp(\`^(\${LANGUAGE_GROUP}) hits \\\\d{4}$\`)

export const resolveFeedAlias = (query, languagesParam) => {
  const normalised = String(query || '').trim().toLowerCase().replaceAll(/\\s+/g, ' ')
  if (TRENDING_PATTERN.test(normalised)) {
    return { source: 'trending', languages: parseLanguages(languagesParam), sort: 'trending' }
  }
  const newest = NEW_PATTERN.exec(normalised)
  if (newest) return { source: 'new-releases', languages: [newest[1]], sort: 'newest' }
  const hits = HITS_PATTERN.exec(normalised)
  if (hits) return { source: 'trending', languages: [hits[1]], sort: 'plays' }
  return null
}
`,
    'utf8'
  )

  fs.writeFileSync(
    path.join(src, 'modules/search/helpers/index.js'),
    `export * from './search.helper.js'
export * from './feed-alias.helper.js'
`,
    'utf8'
  )

  fs.writeFileSync(
    path.join(src, 'modules/search/use-cases/search-songs/search-songs.use-case.js'),
    `import { Endpoints } from '../../../../common/constants/index.js'
import { useFetch } from '../../../../common/helpers/index.js'
import { GetNewReleasesUseCase, GetTrendingSongsUseCase } from '../../../content/use-cases/index.js'
import { resolveFeedAlias } from '../../helpers/index.js'
import { createSongPayload } from '../../../songs/helpers/index.js'

export class SearchSongsUseCase {
  getTrendingSongsUseCase
  getNewReleasesUseCase

  constructor() {
    this.getTrendingSongsUseCase = new GetTrendingSongsUseCase()
    this.getNewReleasesUseCase = new GetNewReleasesUseCase()
  }

  async execute({ query, limit, page, languages, aliasEnabled = true }) {
    if (aliasEnabled) {
      const feed = await this.feedFor(query, limit, languages)
      if (feed) return feed
    }
    const { data } = await useFetch({
      endpoint: Endpoints.search.songs,
      params: {
        q: query,
        p: page,
        n: limit
      }
    })
    return {
      total: data.total,
      start: data.start,
      results: data.results?.map(createSongPayload).slice(0, limit) || []
    }
  }

  async feedFor(query, limit, languages) {
    const alias = resolveFeedAlias(query, languages)
    if (!alias) return null
    try {
      const results =
        alias.source === 'new-releases'
          ? await this.getNewReleasesUseCase.execute({ languages: alias.languages, limit })
          : await this.getTrendingSongsUseCase.execute({
              languages: alias.languages,
              sort: alias.sort,
              limit
            })
      if (!results.length) return null
      return { total: results.length, start: 0, results }
    } catch {
      return null
    }
  }
}
`,
    'utf8'
  )

  const searchControllerFile = path.join(src, 'modules/search/controllers/search.controller.js')
  const searchControllerRaw = fs.readFileSync(searchControllerFile, 'utf8')
  const patchedSearchController = searchControllerRaw.replace(
    /this\.searchService\.searchSongs\(\{\s*query,\s*page:\s*page\s*\|\|\s*0,\s*limit:\s*limit\s*\|\|\s*10\s*\}\)/,
    `this.searchService.searchSongs({ query, page: page || 0, limit: limit || 10, languages: ctx.req.query('languages') })`
  )
  fs.writeFileSync(searchControllerFile, patchedSearchController, 'utf8')

  // 10. Export ContentController + PlaylistController from `modules/index.js`, mount in `server.js` & `app.js`
  fs.writeFileSync(
    path.join(src, 'modules/index.js'),
    `export * from './albums/controllers/index.js'
export * from './search/controllers/index.js'
export * from './songs/controllers/index.js'
export * from './artists/controllers/index.js'
export * from './playlists/controllers/index.js'
export * from './content/controllers/index.js'
`,
    'utf8'
  )

  fs.writeFileSync(
    path.join(src, 'server.js'),
    `import {
  AlbumController,
  ArtistController,
  ContentController,
  PlaylistController,
  SearchController,
  SongController
} from './modules/index.js'
import { App } from './app.js'

const app = new App([
  new SearchController(),
  new SongController(),
  new AlbumController(),
  new ArtistController(),
  new PlaylistController(),
  new ContentController()
]).getApp()

export default app
`,
    'utf8'
  )

  // Add cacheHeaders middleware cleanly into `app.js`
  const appFile = path.join(src, 'app.js')
  let appCode = fs.readFileSync(appFile, 'utf8')
  if (!appCode.includes('cacheControlFor')) {
    appCode =
      `import { cacheControlFor } from './common/helpers/index.js'\n` +
      appCode.replace(
        'this.app.use(cors());',
        `this.app.use(cors());
    this.app.use(async (ctx, next) => {
      await next();
      if (ctx.req.method !== 'GET') return;
      if (ctx.res.status >= 400) {
        ctx.res.headers.set('Cache-Control', 'no-store');
        return;
      }
      if (!ctx.res.headers.has('Cache-Control')) {
        ctx.res.headers.set('Cache-Control', cacheControlFor(new URL(ctx.req.url).pathname));
      }
    });`
      )
    fs.writeFileSync(appFile, appCode, 'utf8')
  }
}

async function main() {
  const { sourceDir } = parseArgs(process.argv)
  let workDir = sourceDir
  let tempDir = null

  try {
    if (!workDir) {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jiosaavn-upstream-'))
      execFileSync(
        'git',
        ['clone', '--depth', '1', '--branch', UPSTREAM_BRANCH, UPSTREAM_REPO, tempDir],
        { stdio: 'inherit' }
      )
      workDir = tempDir
    }

    const commit = execFileSync('git', ['-C', workDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const commitMessage = execFileSync('git', ['-C', workDir, 'log', '-1', '--pretty=%s'], {
      encoding: 'utf8',
    }).trim()
    const commitDate = execFileSync('git', ['-C', workDir, 'log', '-1', '--pretty=%cI'], {
      encoding: 'utf8',
    }).trim()

    const upstreamSrc = path.join(workDir, 'src')
    fs.rmSync(TARGET_SRC, { recursive: true, force: true })
    fs.mkdirSync(TARGET_SRC, { recursive: true })

    let compiledCount = 0
    for (const srcFile of walkFiles(upstreamSrc)) {
      const rel = path.relative(upstreamSrc, srcFile)
      const ext = path.extname(rel)
      if (ext !== '.ts' && ext !== '.tsx') continue

      const outRel = rel.replace(/\.(tsx|ts)$/, '.js')
      const outPath = path.join(TARGET_SRC, outRel)
      fs.mkdirSync(path.dirname(outPath), { recursive: true })

      const sourceCode = fs.readFileSync(srcFile, 'utf8')
      const { code } = esbuild.transformSync(sourceCode, {
        loader: ext === '.tsx' ? 'tsx' : 'ts',
        format: 'esm',
        target: 'es2022',
        jsx: 'automatic',
        jsxImportSource: 'hono/jsx',
      })
      fs.writeFileSync(outPath, code, 'utf8')
      compiledCount += 1
    }

    rewriteImportsInDir(TARGET_SRC)

    const upstreamMeta = {
      repository: UPSTREAM_REPO,
      branch: UPSTREAM_BRANCH,
      commit,
      commitMessage,
      commitDate,
      syncedAt: new Date().toISOString(),
      compiledFiles: compiledCount,
    }
    applyEnhancements(TARGET_ROOT, upstreamMeta)

    console.log(
      `Synced ${compiledCount} files from ${UPSTREAM_REPO}@${commit.slice(0, 7)} ("${commitMessage}")`
    )
  } finally {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
