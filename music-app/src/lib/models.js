// ==========================================================================
// Domain data model — composite provider keys and persistence hygiene.
// --------------------------------------------------------------------------
// Multiple catalogs cannot share bare string IDs safely: an opaque ID from one
// catalog can collide with another, and raw expiring CDN URLs persisted into
// local storage turn a queue restore into an immediate 403/410 failure.
//
// Every domain record here carries a composite `(provider, providerTrackId)`
// identity (`<provider>:<providerTrackId>`), separates stable catalog metadata
// from transient playback URLs, and forbids storing passwords, browser cookies,
// or raw bearer secrets in account state.
// ==========================================================================

import { parseExpiry } from './stream.js'

export const DEFAULT_PROVIDER = 'jiosaavn'

const SECRET_PARAMS = new Set([
  'sig',
  'lsig',
  'signature',
  's',
  'token',
  'access_token',
  'refresh_token',
  'auth',
  'authorization',
  'api_key',
  'apikey',
  'key',
  'pot',
  'cookie',
  'sapisidhash',
])

const FORBIDDEN_ACCOUNT_FIELDS = [
  'password',
  'passwd',
  'cookie',
  'cookies',
  'sapisid',
  'sapisidhash',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'clientSecret',
  'bearer',
]

/** Normalise a provider slug (`jiosaavn`, `ytmusic`, or a partner slug). */
export function normalizeProviderId(provider) {
  const clean = String(provider || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
  return clean || DEFAULT_PROVIDER
}

/** Build a collision-proof composite key `<provider>:<id>`. */
export function compositeKey(provider, providerItemId) {
  const p = normalizeProviderId(provider)
  const raw = String(providerItemId || '').trim()
  if (!raw) throw new Error('providerItemId is required for a composite key')
  // Idempotent if the caller already passed `<provider>:<id>`.
  if (raw.startsWith(`${p}:`)) return raw
  return `${p}:${raw}`
}

/** Split `<provider>:<id>` back into `{ provider, id }`. Legacy bare IDs map to JioSaavn. */
export function parseCompositeKey(value) {
  const raw = String(value || '').trim()
  if (!raw) return { provider: DEFAULT_PROVIDER, id: '' }
  const idx = raw.indexOf(':')
  if (idx <= 0) return { provider: DEFAULT_PROVIDER, id: raw }
  const prefix = raw.slice(0, idx)
  const rest = raw.slice(idx + 1)
  if (prefix === 'yt') return { provider: 'ytmusic', id: rest }
  return { provider: normalizeProviderId(prefix), id: rest }
}

/** Canonical `(provider, providerTrackId)` key for any song or Track object. */
export function trackKey(item) {
  if (!item) return ''
  if (item.provider && item.providerTrackId) {
    return compositeKey(item.provider, item.providerTrackId)
  }
  if (item.source === 'ytmusic' || item.videoId || String(item.id || '').startsWith('yt:')) {
    const vid = item.videoId || String(item.id || '').replace(/^yt:/, '')
    return vid ? compositeKey('ytmusic', vid) : ''
  }
  const parsed = parseCompositeKey(item.id)
  return parsed.id ? compositeKey(parsed.provider, parsed.id) : ''
}

function extractArtists(input) {
  if (Array.isArray(input?.artists)) {
    return input.artists
      .map((a) => (typeof a === 'string' ? a.trim() : String(a?.name || '').trim()))
      .filter(Boolean)
  }
  if (Array.isArray(input?.artists?.primary)) {
    return input.artists.primary.map((a) => String(a?.name || '').trim()).filter(Boolean)
  }
  if (typeof input?.artist === 'string' && input.artist.trim()) {
    return input.artist
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return []
}

function extractArtwork(input) {
  if (typeof input?.artworkRef === 'string' && input.artworkRef) return input.artworkRef
  if (typeof input?.artworkUrl === 'string' && input.artworkUrl) return input.artworkUrl
  if (typeof input?.thumbnail === 'string' && input.thumbnail) return input.thumbnail
  if (Array.isArray(input?.image) && input.image.length) {
    const last = input.image[input.image.length - 1]
    return typeof last === 'string' ? last : last?.url || null
  }
  return null
}

/**
 * Canonical `Track` domain entity:
 * `Track(provider, providerTrackId, title, artists, albumId?, durationMs?, artworkRef?, explicit?, availabilityRegion?, updatedAt)`
 */
export function createTrack(input, nowMs = Date.now()) {
  if (!input || typeof input !== 'object') {
    throw new Error('Track input must be an object')
  }
  const inferred =
    input.provider && input.providerTrackId
      ? { provider: normalizeProviderId(input.provider), id: String(input.providerTrackId).trim() }
      : input.source === 'ytmusic' || input.videoId || String(input.id || '').startsWith('yt:')
        ? {
            provider: 'ytmusic',
            id: String(input.videoId || String(input.id || '').replace(/^yt:/, '')).trim(),
          }
        : parseCompositeKey(input.providerTrackId || input.id)

  if (!inferred.id) throw new Error('Track requires a non-empty providerTrackId')

  const title = String(input.title ?? input.name ?? '').trim()
  if (!title) throw new Error('Track requires a non-empty title')

  const durationMs =
    input.durationMs != null && Number.isFinite(Number(input.durationMs))
      ? Math.max(0, Math.round(Number(input.durationMs)))
      : input.duration != null && Number.isFinite(Number(input.duration))
        ? Math.max(0, Math.round(Number(input.duration) * 1000))
        : null

  return {
    key: compositeKey(inferred.provider, inferred.id),
    provider: inferred.provider,
    providerTrackId: inferred.id,
    title,
    artists: extractArtists(input),
    albumId: input.albumId ?? input.album?.id ?? null,
    albumTitle: input.albumTitle ?? (typeof input.album === 'string' ? input.album : input.album?.name ?? null),
    durationMs,
    artworkRef: extractArtwork(input),
    explicit:
      typeof input.explicit === 'boolean'
        ? input.explicit
        : input.explicitContent != null
          ? Boolean(Number(input.explicitContent))
          : null,
    availabilityRegion: input.availabilityRegion || null,
    updatedAt: Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : nowMs,
  }
}

/** Lightweight `TrackSummary` returned by `CatalogProvider.search` / `getPlaylist`. */
export function toTrackSummary(input) {
  const t = createTrack(input)
  return {
    key: t.key,
    provider: t.provider,
    providerTrackId: t.providerTrackId,
    title: t.title,
    artists: t.artists,
    albumTitle: t.albumTitle,
    durationMs: t.durationMs,
    artworkUrl: t.artworkRef,
    explicit: t.explicit,
  }
}

/**
 * Convert a `Track` or `TrackSummary` into the song shape VIBEX components
 * render, without fabricating stream URLs where none exist.
 */
export function toAppSong(track, { downloadUrl = [] } = {}) {
  const t = track?.provider && track?.providerTrackId ? track : createTrack(track)
  const title = t.title
  const durationSec = t.durationMs != null ? Math.round(t.durationMs / 1000) : 0
  const isYt = t.provider === 'ytmusic'
  return {
    id: isYt ? `yt:${t.providerTrackId}` : t.provider === DEFAULT_PROVIDER ? t.providerTrackId : t.key,
    key: t.key,
    provider: t.provider,
    providerTrackId: t.providerTrackId,
    ...(isYt ? { videoId: t.providerTrackId, source: 'ytmusic' } : { source: t.provider }),
    name: title,
    subtitle: [t.artists.join(', '), t.albumTitle].filter(Boolean).join(' • '),
    duration: durationSec,
    explicitContent: t.explicit ? 1 : 0,
    album: t.albumTitle || t.albumId ? { id: t.albumId || undefined, name: t.albumTitle || '' } : null,
    artists: {
      primary: t.artists.map((name) => ({ name })),
      all: [],
    },
    image: (t.artworkRef ?? t.artworkUrl)
      ? [{ quality: '500x500', url: t.artworkRef ?? t.artworkUrl }]
      : [],
    downloadUrl: Array.isArray(downloadUrl) ? downloadUrl : [],
    ...(isYt ? { url: `https://music.youtube.com/watch?v=${t.providerTrackId}` } : {}),
  }
}

/** `Album(provider, providerAlbumId, title, artists, artworkRef?, releaseDate?)` */
export function createAlbum(input) {
  const provider = normalizeProviderId(input?.provider)
  const providerAlbumId = String(input?.providerAlbumId ?? input?.id ?? '').trim()
  const title = String(input?.title ?? input?.name ?? '').trim()
  if (!providerAlbumId || !title) throw new Error('Album requires providerAlbumId and title')
  return {
    key: compositeKey(provider, providerAlbumId),
    provider,
    providerAlbumId,
    title,
    artists: extractArtists(input),
    artworkRef: extractArtwork(input),
    releaseDate: input?.releaseDate ?? input?.year ?? null,
  }
}

/** `PlaylistEntry(playlistId, providerTrackId, position, addedAt?)` */
export function createPlaylistEntry({ playlistId, provider = DEFAULT_PROVIDER, providerTrackId, position = 0, addedAt = Date.now() }) {
  const p = normalizeProviderId(provider)
  const id = String(providerTrackId || '').trim()
  if (!playlistId || !id) throw new Error('PlaylistEntry requires playlistId and providerTrackId')
  return {
    playlistId: String(playlistId),
    provider: p,
    providerTrackId: id,
    key: compositeKey(p, id),
    position: Math.max(0, Math.floor(Number(position) || 0)),
    addedAt: Number.isFinite(Number(addedAt)) ? Number(addedAt) : Date.now(),
  }
}

/** `Playlist(provider, providerPlaylistId, title, ownerId?, isEditable, syncEnabled, remoteRevision?)` */
export function createPlaylist(input) {
  const provider = normalizeProviderId(input?.provider || 'local')
  const providerPlaylistId = String(input?.providerPlaylistId ?? input?.id ?? '').trim()
  const title = String(input?.title ?? input?.name ?? '').trim()
  if (!providerPlaylistId || !title) throw new Error('Playlist requires providerPlaylistId and title')
  const entries = Array.isArray(input?.entries)
    ? input.entries.map((entry, idx) =>
        createPlaylistEntry({
          playlistId: providerPlaylistId,
          provider: entry.provider || provider,
          providerTrackId: entry.providerTrackId || entry.id,
          position: entry.position ?? idx,
          addedAt: entry.addedAt,
        })
      )
    : []
  return {
    id: providerPlaylistId,
    key: compositeKey(provider, providerPlaylistId),
    provider,
    providerPlaylistId,
    title,
    ownerId: input?.ownerId || null,
    isEditable: input?.isEditable !== false,
    syncEnabled: Boolean(input?.syncEnabled),
    remoteRevision: input?.remoteRevision || null,
    entries,
    updatedAt: Number.isFinite(Number(input?.updatedAt)) ? Number(input.updatedAt) : Date.now(),
  }
}

/** `QueueEntry(queueId, providerTrackId, position, sourceContext?)` */
export function createQueueEntry(song, position = 0, sourceContext = null, queueId = 'main') {
  const key = trackKey(song)
  const parsed = parseCompositeKey(key)
  if (!parsed.id) throw new Error('QueueEntry requires a resolvable track identity')
  return {
    queueId: String(queueId),
    provider: parsed.provider,
    providerTrackId: parsed.id,
    key: compositeKey(parsed.provider, parsed.id),
    position: Math.max(0, Math.floor(Number(position) || 0)),
    sourceContext: sourceContext || null,
  }
}

/**
 * Reject raw credentials, passwords, or scraped browser cookies anywhere an
 * `Account` record is constructed or persisted.
 */
export function assertSafeAccountInput(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Account input must be an object')
  }
  for (const field of FORBIDDEN_ACCOUNT_FIELDS) {
    if (input[field] != null && String(input[field]).length > 0) {
      throw new Error(`Account record must never contain raw secret field "${field}"`)
    }
  }
  const ref = String(input.authStateRef || '')
  if (/SAPISID|SID=|__Secure-|Bearer\s+[A-Za-z0-9._-]+/i.test(ref)) {
    throw new Error('authStateRef must be an opaque secure-storage handle, never a raw cookie or bearer token')
  }
}

/** `Account(provider, providerAccountId, displayName, authStateRef)` */
export function createAccount(input) {
  assertSafeAccountInput(input)
  const provider = normalizeProviderId(input.provider)
  const providerAccountId = String(input.providerAccountId || '').trim()
  const displayName = String(input.displayName || '').trim()
  const authStateRef = String(input.authStateRef || '').trim()
  if (!providerAccountId || !authStateRef) {
    throw new Error('Account requires providerAccountId and an opaque authStateRef handle')
  }
  return {
    accountId: compositeKey(provider, providerAccountId),
    provider,
    providerAccountId,
    displayName: displayName || providerAccountId,
    scopes: Array.isArray(input.scopes) ? [...input.scopes] : [],
    authStateRef,
  }
}

/** `SyncState(accountId, collection, cursor, lastSuccessfulSyncAt, status)` */
export function createSyncState({
  accountId,
  collection = 'library',
  cursor = null,
  lastSuccessfulSyncAt = null,
  status = 'idle',
  errorCategory = null,
}) {
  if (!accountId) throw new Error('SyncState requires accountId')
  return {
    accountId: String(accountId),
    collection: String(collection),
    cursor: cursor == null ? null : String(cursor),
    lastSuccessfulSyncAt:
      lastSuccessfulSyncAt != null && Number.isFinite(Number(lastSuccessfulSyncAt))
        ? Number(lastSuccessfulSyncAt)
        : null,
    status: String(status),
    errorCategory: errorCategory || null,
  }
}

// ==========================================================================
// Credential redaction & persistence hygiene
// ==========================================================================

/** Strip query tokens, signatures, and embedded userinfo before logging any URL. */
export function redactUrl(url) {
  if (typeof url !== 'string' || !url) return ''
  try {
    const parsed = new URL(url, 'https://redacted.local')
    parsed.username = ''
    parsed.password = ''
    for (const key of [...parsed.searchParams.keys()]) {
      if (SECRET_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, '[REDACTED]')
      }
    }
    if (parsed.origin === 'https://redacted.local' && !/^https?:\/\//i.test(url)) {
      return `${parsed.pathname}${parsed.search}`
    }
    return parsed.toString()
  } catch {
    return '[invalid-url]'
  }
}

/** Redact `ResolvedPlayback` for safe diagnostics/telemetry logging. */
export function redactResolvedPlayback(resolved) {
  if (!resolved || typeof resolved !== 'object') return null
  const headers = resolved.requestHeaders && typeof resolved.requestHeaders === 'object'
    ? Object.fromEntries(Object.keys(resolved.requestHeaders).map((k) => [k, '[REDACTED]']))
    : {}
  return {
    mode: resolved.mode || 'stream',
    uri: redactUrl(resolved.uri),
    mimeType: resolved.mimeType || null,
    expiresAtEpochMs: resolved.expiresAtEpochMs ?? null,
    requestHeaders: headers,
    license: resolved.license
      ? {
          system: resolved.license.system || 'unknown',
          licenseServerUrl: redactUrl(resolved.license.licenseServerUrl || ''),
        }
      : null,
  }
}

/**
 * Strip transient `ResolvedPlayback`, auth headers, and expiring stream URLs
 * before writing any song or queue entry to persistent storage (`localStorage`).
 *
 * Non-expiring static catalog URLs (such as unsigned CDN paths) remain intact;
 * signed URLs carrying `?expire=` / `?expires=` or an explicit `expiresAtEpochMs`
 * are stripped so stale expiring URLs are never persisted across sessions.
 */
export function sanitizeTrackForPersistence(song) {
  if (!song || typeof song !== 'object') return null
  const copy = { ...song }
  delete copy._resolvedPlayback
  delete copy.requestHeaders
  delete copy.license
  delete copy.authToken
  delete copy.cookie

  const key = trackKey(copy)
  if (key && !copy.key) copy.key = key

  if (Array.isArray(copy.downloadUrl)) {
    copy.downloadUrl = copy.downloadUrl.filter((entry) => {
      const url = typeof entry === 'string' ? entry : entry?.url
      if (!url) return false
      if (entry && typeof entry === 'object' && entry.expiresAtEpochMs != null) return false
      // Never persist a raw expiring stream URL (`?expire=` / `?expires=`).
      if (parseExpiry(url) != null) return false
      return true
    })
  }
  return copy
}
