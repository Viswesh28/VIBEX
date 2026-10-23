// ==========================================================================
// Provider adapter interfaces — CatalogProvider, StreamResolver, AccountProvider.
// --------------------------------------------------------------------------
// Keeps all provider-specific wire formats behind uniform, contract-checked
// interfaces so a licensed catalog/playback/account SDK can be added or swapped
// without rewriting UI components, queue persistence, or sync logic.
// ==========================================================================

import { api as defaultApi, apiFetch as defaultApiFetch } from './api.js'
import {
  DEFAULT_PROVIDER,
  compositeKey,
  createTrack,
  normalizeProviderId,
  parseCompositeKey,
  toAppSong,
  toTrackSummary,
} from './models.js'
import { PLAYBACK_FAILURE } from './playbackState.js'
import { effQ, streamOf } from './song.js'
import { SOURCE_ID, cataloguePath, isYtTrack, mapYtResults } from './sources.js'
import { isExpired, parseExpiry } from './stream.js'
import { embedUrl, videoIdOf } from './ytEmbed.js'

export class ProviderError extends Error {
  constructor(message, { category = PLAYBACK_FAILURE.ProviderUnavailable, status = 0, retryAfterMs = null } = {}) {
    super(message)
    this.name = 'ProviderError'
    this.category = category
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

// ==========================================================================
// Bounded TTL cache for non-sensitive catalog metadata ONLY.
// Protected audio bytes and ResolvedPlayback URIs must never be stored here.
// ==========================================================================

export class MetadataCache {
  constructor({ ttlMs = 5 * 60 * 1000, maxEntries = 150, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs
    this.maxEntries = maxEntries
    this.now = now
    this.entries = new Map()
  }

  get(key) {
    const entry = this.entries.get(key)
    if (!entry) return null
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return null
    }
    // Refresh insertion order for LRU eviction.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key, value, customTtlMs = this.ttlMs) {
    if (customTtlMs <= 0) return value
    if (this.entries.has(key)) this.entries.delete(key)
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value
      this.entries.delete(oldest)
    }
    this.entries.set(key, {
      value,
      expiresAt: this.now() + customTtlMs,
    })
    return value
  }

  delete(key) {
    this.entries.delete(key)
  }

  clear() {
    this.entries.clear()
  }

  get size() {
    return this.entries.size
  }
}

// ==========================================================================
// Contract validators
// ==========================================================================

export function validateCatalogProvider(provider) {
  if (!provider || typeof provider !== 'object') {
    throw new Error('CatalogProvider must be an object')
  }
  for (const method of ['search', 'getTrack', 'getPlaylist']) {
    if (typeof provider[method] !== 'function') {
      throw new Error(`CatalogProvider.${method} must be a function`)
    }
  }
  return provider
}

export function validateStreamResolver(resolver) {
  if (!resolver || typeof resolver !== 'object' || typeof resolver.resolve !== 'function') {
    throw new Error('StreamResolver.resolve(trackId, quality) must be a function')
  }
  return resolver
}

export function validateAccountProvider(provider) {
  if (!provider || typeof provider !== 'object') {
    throw new Error('AccountProvider must be an object')
  }
  for (const method of ['signIn', 'syncLibrary', 'signOut']) {
    if (typeof provider[method] !== 'function') {
      throw new Error(`AccountProvider.${method} must be a function`)
    }
  }
  return provider
}

// ==========================================================================
// Built-in CatalogProvider adapters
// ==========================================================================

/**
 * JioSaavn `CatalogProvider`:
 * - `search(query, { pageToken, limit })` → `{ items: TrackSummary[], songs, nextPageToken, total }`
 * - `getTrack(providerTrackId)`           → `Track` + `song`
 * - `getPlaylist(providerPlaylistId)`     → `{ id, title, items: TrackSummary[], songs, nextPageToken }`
 */
export function createJioSaavnCatalogProvider({
  apiFn = defaultApi,
  cache = new MetadataCache(),
} = {}) {
  const providerId = SOURCE_ID.jiosaavn

  return validateCatalogProvider({
    id: providerId,
    label: 'JioSaavn',

    async search(query, { pageToken = null, limit = 20 } = {}) {
      const q = String(query || '').trim()
      if (!q) return { items: [], songs: [], nextPageToken: null, total: 0 }
      const page = pageToken ? Math.max(0, Math.floor(Number(pageToken) || 0)) : 0
      const cacheKey = `saavn:search:${q.toLowerCase()}:${page}:${limit}`
      const hit = cache.get(cacheKey)
      if (hit) return hit

      const path = cataloguePath(providerId, q, limit, page > 0 ? String(page) : null)
      const data = await apiFn(path)
      const songs = Array.isArray(data?.results) ? data.results : []
      const items = songs
        .filter((s) => s?.id && (s?.name || s?.title))
        .map((s) => toTrackSummary({ ...s, provider: providerId, providerTrackId: s.id }))
      const total = Number(data?.total) || items.length
      const consumed = page * limit + songs.length
      const nextPageToken = songs.length > 0 && total > consumed ? String(page + 1) : null
      return cache.set(cacheKey, { items, songs, nextPageToken, total })
    },

    async getTrack(providerTrackId) {
      const parsed = parseCompositeKey(providerTrackId)
      const id = parsed.id
      if (!id) throw new ProviderError('Track ID is required', { category: PLAYBACK_FAILURE.ProviderUnavailable })
      const cacheKey = `saavn:track:${id}`
      const hit = cache.get(cacheKey)
      if (hit) return hit

      const data = await apiFn(`/songs/${encodeURIComponent(id)}`)
      const raw = Array.isArray(data) ? data[0] : data?.songs?.[0] || data?.song || data
      if (!raw?.id) {
        throw new ProviderError(`Track ${id} not found`, { category: PLAYBACK_FAILURE.ProviderUnavailable, status: 404 })
      }
      const track = createTrack({ ...raw, provider: providerId, providerTrackId: raw.id })
      return cache.set(cacheKey, { track, song: raw })
    },

    async getPlaylist(providerPlaylistId, { pageToken = null, limit = 50 } = {}) {
      const parsed = parseCompositeKey(providerPlaylistId)
      const id = parsed.id
      if (!id) throw new ProviderError('Playlist ID is required', { category: PLAYBACK_FAILURE.ProviderUnavailable })
      const page = pageToken ? Math.max(0, Math.floor(Number(pageToken) || 0)) : 0
      const cacheKey = `saavn:playlist:${id}:${page}:${limit}`
      const hit = cache.get(cacheKey)
      if (hit) return hit

      const data = await apiFn(`/playlists?id=${encodeURIComponent(id)}&page=${page}&limit=${limit}`)
      const songs = Array.isArray(data?.songs) ? data.songs : []
      const items = songs
        .filter((s) => s?.id && (s?.name || s?.title))
        .map((s) => toTrackSummary({ ...s, provider: providerId, providerTrackId: s.id }))
      const songCount = Number(data?.songCount) || items.length
      const nextPageToken = songs.length >= limit && songCount > (page + 1) * limit ? String(page + 1) : null
      return cache.set(cacheKey, {
        id,
        provider: providerId,
        key: compositeKey(providerId, id),
        title: data?.name || 'Playlist',
        items,
        songs,
        nextPageToken,
      })
    },
  })
}

/**
 * YouTube Music `CatalogProvider` (public search & continuation pagination only;
 * no undocumented audio stream extraction, no cookie scraping).
 */
export function createYtMusicCatalogProvider({
  apiFn = defaultApi,
  cache = new MetadataCache(),
} = {}) {
  const providerId = SOURCE_ID.ytmusic

  return validateCatalogProvider({
    id: providerId,
    label: 'YouTube Music',

    async search(query, { pageToken = null, limit = 20 } = {}) {
      const q = String(query || '').trim()
      if (!q && !pageToken) return { items: [], songs: [], nextPageToken: null, total: 0 }
      const cacheKey = `ytmusic:search:${q.toLowerCase()}:${pageToken || 'first'}:${limit}`
      const hit = cache.get(cacheKey)
      if (hit) return hit

      const data = await apiFn(cataloguePath(providerId, q, limit, pageToken))
      const songs = mapYtResults(data?.results)
      const items = songs.map((s) =>
        toTrackSummary({
          provider: providerId,
          providerTrackId: s.videoId,
          title: s.name,
          artists: s.artists?.primary?.map((a) => a.name) || [],
          albumTitle: s.album?.name || null,
          duration: s.duration,
          thumbnail: s.image?.[0]?.url || null,
        })
      )
      const nextPageToken = data?.nextPageToken || null
      const total = Number(data?.total) || items.length
      return cache.set(cacheKey, { items, songs, nextPageToken, total })
    },

    async getTrack(providerTrackId) {
      const parsed = parseCompositeKey(providerTrackId)
      const id = parsed.id
      if (!id) throw new ProviderError('YouTube video ID is required', { category: PLAYBACK_FAILURE.ProviderUnavailable })
      const song = toAppSong(
        createTrack({
          provider: providerId,
          providerTrackId: id,
          title: id,
          artists: [],
        })
      )
      return {
        track: createTrack(song),
        song,
      }
    },

    async getPlaylist() {
      throw new ProviderError(
        'YouTube Music playlist browsing requires an authorized partner API credential.',
        { category: PLAYBACK_FAILURE.AuthorizationRequired, status: 401 }
      )
    },
  })
}

// ==========================================================================
// Built-in StreamResolver adapters
// ==========================================================================

/**
 * JioSaavn `StreamResolver`:
 * Resolves an authorized stream URL at requested `quality`. If a queue item was
 * restored from session storage after its expiring URL was stripped (or its URL
 * expired in memory), fetches fresh playback metadata via `/songs/<id>`.
 */
export function createJioSaavnStreamResolver({
  apiFetchFn = defaultApiFetch,
  now = () => Date.now(),
} = {}) {
  return validateStreamResolver({
    id: SOURCE_ID.jiosaavn,

    async resolve(trackId, quality = '320kbps', { track = null, forceRefresh = false, dataSaver = false } = {}) {
      const parsed = parseCompositeKey(trackId || track?.id)
      const id = parsed.id

      const pickFromSong = (candidate) => {
        if (!candidate?.downloadUrl?.length) return null
        const targetQ = effQ(candidate, quality, dataSaver)
        const direct = streamOf(candidate, targetQ)
        if (!direct || isExpired(direct, now())) return null
        const expSec = parseExpiry(direct)
        return {
          mode: 'stream',
          uri: direct,
          mimeType: 'audio/mp4',
          quality: targetQ,
          expiresAtEpochMs: expSec != null ? expSec * 1000 : null,
          requestHeaders: {},
          license: null,
        }
      }

      if (!forceRefresh && track) {
        const inline = pickFromSong(track)
        if (inline) return inline
      }

      if (!id) {
        throw new ProviderError('Track has no ID to resolve.', {
          category: PLAYBACK_FAILURE.ProviderUnavailable,
        })
      }

      let response
      try {
        response = await apiFetchFn(`/songs/${encodeURIComponent(id)}`, {
          headers: { accept: 'application/json' },
        })
      } catch (err) {
        throw new ProviderError(err?.message || 'Network error while resolving playback', {
          category: PLAYBACK_FAILURE.NetworkRetryable,
        })
      }

      if (response.status === 401) {
        throw new ProviderError('Authorization required to resolve stream.', {
          category: PLAYBACK_FAILURE.AuthorizationRequired,
          status: 401,
        })
      }
      if (response.status === 451) {
        throw new ProviderError('Track unavailable in this territory.', {
          category: PLAYBACK_FAILURE.NotAvailableInRegion,
          status: 451,
        })
      }
      if (!response.ok) {
        throw new ProviderError(`Catalog failed to resolve track (${response.status}).`, {
          category: PLAYBACK_FAILURE.ProviderUnavailable,
          status: response.status,
        })
      }

      const payload = await response.json().catch(() => null)
      const data = payload?.data
      const freshSong = Array.isArray(data) ? data[0] : data?.songs?.[0] || data?.song || data
      const resolved = pickFromSong(freshSong)
      if (!resolved) {
        throw new ProviderError('No stream available for this track.', {
          category: PLAYBACK_FAILURE.UnsupportedFormat,
        })
      }
      return { ...resolved, song: freshSong }
    },
  })
}

/**
 * YouTube Music `StreamResolver`:
 * Never extracts raw audio streams — resolves exclusively to YouTube's official
 * IFrame embed player (`mode: 'embed'`), respecting rights-holder controls.
 */
export function createYtMusicEmbedResolver({
  getOrigin = () => (typeof window !== 'undefined' ? window.location.origin : ''),
} = {}) {
  return validateStreamResolver({
    id: SOURCE_ID.ytmusic,

    async resolve(trackId, _quality, { track = null } = {}) {
      const parsed = parseCompositeKey(trackId)
      const videoId = videoIdOf(track || { videoId: parsed.id })
      if (!videoId) {
        throw new ProviderError('No valid YouTube video ID available.', {
          category: PLAYBACK_FAILURE.UnsupportedFormat,
        })
      }
      return {
        mode: 'embed',
        videoId,
        uri: embedUrl({ videoId }, { origin: getOrigin(), autoplay: true }),
        mimeType: 'text/html',
        expiresAtEpochMs: null,
        requestHeaders: {},
        license: null,
      }
    },
  })
}

// ==========================================================================
// Registry — plug in licensed providers cleanly at runtime or in tests
// ==========================================================================

export function createProviderRegistry({
  apiFn = defaultApi,
  apiFetchFn = defaultApiFetch,
  cache = new MetadataCache(),
} = {}) {
  const catalogs = new Map()
  const resolvers = new Map()
  const accounts = new Map()

  const registerCatalog = (id, provider) => {
    catalogs.set(normalizeProviderId(id), validateCatalogProvider(provider))
    return provider
  }

  const registerStreamResolver = (id, resolver) => {
    resolvers.set(normalizeProviderId(id), validateStreamResolver(resolver))
    return resolver
  }

  const registerAccountProvider = (id, provider) => {
    accounts.set(normalizeProviderId(id), validateAccountProvider(provider))
    return provider
  }

  registerCatalog(SOURCE_ID.jiosaavn, createJioSaavnCatalogProvider({ apiFn, cache }))
  registerCatalog(SOURCE_ID.ytmusic, createYtMusicCatalogProvider({ apiFn, cache }))
  registerStreamResolver(SOURCE_ID.jiosaavn, createJioSaavnStreamResolver({ apiFetchFn }))
  registerStreamResolver(SOURCE_ID.ytmusic, createYtMusicEmbedResolver())

  return {
    cache,
    registerCatalog,
    registerStreamResolver,
    registerAccountProvider,
    getCatalog: (id) => catalogs.get(normalizeProviderId(id)) || catalogs.get(DEFAULT_PROVIDER),
    getStreamResolver: (trackOrProviderId) => {
      if (trackOrProviderId && typeof trackOrProviderId === 'object') {
        if (isYtTrack(trackOrProviderId)) return resolvers.get(SOURCE_ID.ytmusic)
        if (trackOrProviderId.provider) {
          return resolvers.get(normalizeProviderId(trackOrProviderId.provider)) || resolvers.get(DEFAULT_PROVIDER)
        }
        const parsed = parseCompositeKey(trackOrProviderId.id)
        return resolvers.get(parsed.provider) || resolvers.get(DEFAULT_PROVIDER)
      }
      return resolvers.get(normalizeProviderId(trackOrProviderId)) || resolvers.get(DEFAULT_PROVIDER)
    },
    getAccountProvider: (id) => accounts.get(normalizeProviderId(id)) || null,
    listAccountProviders: () => [...accounts.keys()],
  }
}

export const defaultProviders = createProviderRegistry()
