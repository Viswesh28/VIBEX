// ==========================================================================
// Opt-in library synchronization engine.
// --------------------------------------------------------------------------
// Implements the contract-safe sync rules:
// 1. Explicit opt-in naming the exact collections read (`liked`, `playlists`).
// 2. Delegated OAuth/SDK session handles only — passwords, cookies, and
//    `SAPISIDHASH` strings are strictly rejected.
// 3. Cursor pagination: each page is written transactionally into a dedicated
//    remote mirror, and `SyncState.cursor` advances ONLY AFTER storage writes
//    succeed so a crash or drop resumes cleanly on the next run.
// 4. Conservative removals: local-only likes & playlists are NEVER deleted on
//    partial, failed, or full remote syncs; stale remote-mirror items are only
//    pruned after a full scan from `cursor = null` (`complete === true`) or an
//    authoritative tombstone (`removedKeys`).
// 5. Rate limits (`429` / `5xx`) back off with server guidance + jitter;
//    expired/revoked credentials halt immediately as `AuthorizationRequired`.
// ==========================================================================

import {
  assertSafeAccountInput,
  createAccount,
  createSyncState,
  sanitizeTrackForPersistence,
  trackKey,
} from './models.js'
import { PLAYBACK_FAILURE, computeBackoffMs } from './playbackState.js'

export const SYNC_STATUS = {
  idle: 'idle',
  syncing: 'syncing',
  paused: 'paused',
  synced: 'synced',
  authRequired: 'auth_required',
  error: 'error',
  disconnected: 'disconnected',
}

export const CONFLICT_POLICY = {
  keepBoth: 'keep_both',
  preferLocal: 'prefer_local',
  preferRemote: 'prefer_remote',
}

export function emptyRemoteMirror() {
  return {
    liked: [],
    playlists: [],
    updatedAt: null,
  }
}

/** Verify explicit user consent naming the collections to sync. */
export function requireSyncConsent(consent) {
  if (!consent || consent.granted !== true) {
    throw new Error('Explicit user opt-in is required before account synchronization can run.')
  }
  const allowed = new Set(['liked', 'playlists'])
  const collections = Array.isArray(consent.collections)
    ? consent.collections.filter((c) => allowed.has(c))
    : []
  if (!collections.length) {
    throw new Error('Sync consent must specify at least one collection ("liked" or "playlists").')
  }
  return collections
}

/** Validate `AccountSession` returned by `AccountProvider.signIn()`. */
export function validateDelegatedSession(session) {
  assertSafeAccountInput(session)
  return createAccount(session)
}

function normalizeRemoteSong(item) {
  const cleaned = sanitizeTrackForPersistence(item)
  if (!cleaned) return null
  const key = trackKey(cleaned)
  if (!key) return null
  return { ...cleaned, key, _origin: 'remote' }
}

function normalizeRemotePlaylist(pl) {
  if (!pl || typeof pl !== 'object' || !(pl.id || pl.providerPlaylistId) || !(pl.name || pl.title)) {
    return null
  }
  const id = String(pl.providerPlaylistId || pl.id)
  const provider = String(pl.provider || 'remote')
  const songs = Array.isArray(pl.songs)
    ? pl.songs.map(normalizeRemoteSong).filter(Boolean)
    : []
  return {
    id: id.startsWith(`${provider}:`) ? id : `${provider}:${id}`,
    provider,
    providerPlaylistId: id,
    name: String(pl.name ?? pl.title),
    remoteRevision: pl.remoteRevision || null,
    syncEnabled: true,
    isEditable: pl.isEditable !== false,
    songs,
    _origin: 'remote',
  }
}

/**
 * Merge local library state (`svLiked`, `svPlaylists`) with the separate
 * remote mirror (`svRemoteMirror`) using composite `(provider, providerTrackId)`
 * keys and explicit conflict behavior for edited playlists.
 *
 * Local items are NEVER modified or deleted here.
 */
export function mergeLibraryViews({
  localLiked = [],
  localPlaylists = [],
  remoteMirror = emptyRemoteMirror(),
  conflictPolicy = CONFLICT_POLICY.keepBoth,
} = {}) {
  const likedByKey = new Map()
  const mergedLiked = []

  for (const song of localLiked) {
    if (!song) continue
    const key = trackKey(song) || song.id
    if (!key || likedByKey.has(key)) continue
    const entry = { ...song, key, _origin: 'local' }
    likedByKey.set(key, entry)
    mergedLiked.push(entry)
  }

  for (const song of remoteMirror?.liked || []) {
    if (!song) continue
    const key = trackKey(song) || song.id
    if (!key) continue
    const existing = likedByKey.get(key)
    if (existing) {
      existing._origin = 'both'
      continue
    }
    const entry = { ...song, key, _origin: 'remote' }
    likedByKey.set(key, entry)
    mergedLiked.push(entry)
  }

  const mergedPlaylists = []
  const remoteByName = new Map(
    (remoteMirror?.playlists || []).map((rp) => [String(rp.name || '').trim().toLowerCase(), rp])
  )
  const consumedRemoteIds = new Set()
  const conflicts = []

  for (const lp of localPlaylists) {
    const normName = String(lp.name || '').trim().toLowerCase()
    const matchingRemote =
      (lp.remoteKey && (remoteMirror?.playlists || []).find((rp) => rp.id === lp.remoteKey)) ||
      remoteByName.get(normName) ||
      null

    if (!matchingRemote) {
      mergedPlaylists.push({ ...lp, _origin: 'local' })
      continue
    }

    consumedRemoteIds.add(matchingRemote.id)
    const localKeys = (lp.songs || []).map((s) => trackKey(s) || s.id).join(',')
    const remoteKeys = (matchingRemote.songs || []).map((s) => trackKey(s) || s.id).join(',')

    if (localKeys === remoteKeys) {
      mergedPlaylists.push({
        ...lp,
        remoteRevision: matchingRemote.remoteRevision,
        _origin: 'both',
      })
      continue
    }

    // Conflict: both local and remote hold different edits for this playlist.
    conflicts.push({
      playlistName: lp.name,
      localId: lp.id,
      remoteId: matchingRemote.id,
      resolution: conflictPolicy,
    })

    if (conflictPolicy === CONFLICT_POLICY.preferLocal) {
      mergedPlaylists.push({ ...lp, _origin: 'local', _conflict: true })
    } else if (conflictPolicy === CONFLICT_POLICY.preferRemote) {
      mergedPlaylists.push({ ...matchingRemote, _origin: 'remote', _conflict: true })
    } else {
      // Default `keep_both`: neither version silently overwrites the other.
      mergedPlaylists.push({ ...lp, _origin: 'local' })
      mergedPlaylists.push({
        ...matchingRemote,
        name: `${matchingRemote.name} (Synced)`,
        _origin: 'remote',
      })
    }
  }

  for (const rp of remoteMirror?.playlists || []) {
    if (!consumedRemoteIds.has(rp.id)) {
      mergedPlaylists.push({ ...rp, _origin: 'remote' })
    }
  }

  return {
    liked: mergedLiked,
    playlists: mergedPlaylists,
    conflicts,
  }
}

/**
 * Run a paginated, resumable sync cycle against an `AccountProvider`.
 *
 * `storage` hooks allow atomic persistence in tests or `localStorage`:
 * - `readMirror()` / `writeMirror(mirror)`
 * - `readSyncState()` / `writeSyncState(state)`
 */
export async function runLibrarySync({
  accountProvider,
  account,
  consent,
  storage,
  collections,
  maxPages = 25,
  maxRetriesPerPage = 2,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  random = Math.random,
  now = () => Date.now(),
}) {
  const grantedCollections = collections || requireSyncConsent(consent)
  const validAccount = createAccount(account)

  const priorState = storage.readSyncState() || createSyncState({
    accountId: validAccount.accountId,
    collection: grantedCollections.join(','),
  })

  if (priorState.status === SYNC_STATUS.paused) {
    return {
      status: SYNC_STATUS.paused,
      syncState: priorState,
      mirror: storage.readMirror() || emptyRemoteMirror(),
      pagesProcessed: 0,
    }
  }

  let cursor = priorState.cursor || null
  const startedFromScratch = cursor === null
  const seenRemoteLikedKeys = new Set()
  const seenRemotePlaylistIds = new Set()

  let workingMirror = {
    liked: [...(storage.readMirror()?.liked || [])],
    playlists: [...(storage.readMirror()?.playlists || [])],
    updatedAt: storage.readMirror()?.updatedAt || null,
  }

  let syncState = createSyncState({
    ...priorState,
    accountId: validAccount.accountId,
    status: SYNC_STATUS.syncing,
    errorCategory: null,
  })
  storage.writeSyncState(syncState)

  let pagesProcessed = 0
  let completedFullScan = false

  while (pagesProcessed < maxPages) {
    let page = null
    let attempt = 0

    while (true) {
      try {
        page = await accountProvider.syncLibrary({
          cursor,
          collections: grantedCollections,
        })
        break
      } catch (err) {
        const status = Number(err?.status || 0)
        const isAuth =
          status === 401 ||
          status === 403 ||
          err?.category === PLAYBACK_FAILURE.AuthorizationRequired ||
          /unauthorized|revoked|expired_token|login_required/i.test(String(err?.message || ''))

        if (isAuth) {
          const authFailed = createSyncState({
            ...syncState,
            cursor,
            status: SYNC_STATUS.authRequired,
            errorCategory: PLAYBACK_FAILURE.AuthorizationRequired,
          })
          storage.writeSyncState(authFailed)
          return {
            status: SYNC_STATUS.authRequired,
            syncState: authFailed,
            mirror: workingMirror,
            pagesProcessed,
          }
        }

        const isTransient =
          status === 429 ||
          status >= 500 ||
          err?.retryable === true ||
          /rate|timeout|network|5\d\d|429/i.test(String(err?.message || ''))

        if (isTransient && attempt < maxRetriesPerPage) {
          const serverWait = Number(err?.retryAfterMs)
          const waitMs =
            Number.isFinite(serverWait) && serverWait >= 0
              ? serverWait
              : computeBackoffMs(attempt, { baseMs: 200, maxMs: 2000, random })
          attempt += 1
          await sleep(waitMs)
          continue
        }

        // Non-auth failure after bounded retries: preserve existing mirror and
        // last committed cursor so the next run resumes without losing data.
        const failed = createSyncState({
          ...syncState,
          cursor,
          status: SYNC_STATUS.error,
          errorCategory: PLAYBACK_FAILURE.ProviderUnavailable,
        })
        storage.writeSyncState(failed)
        return {
          status: SYNC_STATUS.error,
          syncState: failed,
          mirror: workingMirror,
          pagesProcessed,
          error: err,
        }
      }
    }

    pagesProcessed += 1

    // Build next mirror snapshot idempotently in memory before writing.
    const likedMap = new Map(workingMirror.liked.map((s) => [s.key || trackKey(s), s]))
    if (grantedCollections.includes('liked') && Array.isArray(page?.liked)) {
      for (const rawSong of page.liked) {
        const norm = normalizeRemoteSong(rawSong)
        if (!norm) continue
        seenRemoteLikedKeys.add(norm.key)
        likedMap.set(norm.key, norm)
      }
    }

    // Explicit tombstones apply only to the remote mirror, never local items.
    if (Array.isArray(page?.removedKeys)) {
      for (const remKey of page.removedKeys) {
        likedMap.delete(remKey)
      }
    }

    const playlistMap = new Map(workingMirror.playlists.map((p) => [p.id, p]))
    if (grantedCollections.includes('playlists') && Array.isArray(page?.playlists)) {
      for (const rawPl of page.playlists) {
        const normPl = normalizeRemotePlaylist(rawPl)
        if (!normPl) continue
        seenRemotePlaylistIds.add(normPl.id)
        playlistMap.set(normPl.id, normPl)
      }
    }
    if (Array.isArray(page?.removedPlaylistIds)) {
      for (const remId of page.removedPlaylistIds) {
        playlistMap.delete(remId)
      }
    }

    const nextCursor = page?.nextCursor || null
    const isFinalPage = !nextCursor

    // Conservative pruning: ONLY prune unvisited remote-mirror entries when a
    // full scan started at `cursor === null` reached its authoritative end
    // (`page.authoritativeComplete === true`). Partial scans never prune.
    if (isFinalPage && startedFromScratch && page?.authoritativeComplete === true) {
      completedFullScan = true
      if (grantedCollections.includes('liked')) {
        for (const k of [...likedMap.keys()]) {
          if (!seenRemoteLikedKeys.has(k)) likedMap.delete(k)
        }
      }
      if (grantedCollections.includes('playlists')) {
        for (const id of [...playlistMap.keys()]) {
          if (!seenRemotePlaylistIds.has(id)) playlistMap.delete(id)
        }
      }
    }

    const nextMirror = {
      liked: [...likedMap.values()],
      playlists: [...playlistMap.values()],
      updatedAt: now(),
    }

    // Transactional ordering: write page data FIRST, commit cursor SECOND.
    // If `writeMirror` throws, `syncState.cursor` still points at the previous
    // page so retrying replays this page cleanly.
    storage.writeMirror(nextMirror)
    workingMirror = nextMirror
    cursor = nextCursor

    syncState = createSyncState({
      accountId: validAccount.accountId,
      collection: grantedCollections.join(','),
      cursor,
      lastSuccessfulSyncAt: isFinalPage ? now() : syncState.lastSuccessfulSyncAt,
      status: isFinalPage ? SYNC_STATUS.synced : SYNC_STATUS.syncing,
      errorCategory: null,
    })
    storage.writeSyncState(syncState)

    if (isFinalPage) break
  }

  return {
    status: syncState.status,
    syncState,
    mirror: workingMirror,
    pagesProcessed,
    completedFullScan,
  }
}

/** Portable, sanitized JSON snapshot of the user's library for export/backup. */
export function exportLibrarySnapshot({ liked = [], playlists = [], exportedAt = new Date().toISOString() } = {}) {
  return {
    schema: 'vibex-library/v1',
    exportedAt,
    liked: liked.map(sanitizeTrackForPersistence).filter(Boolean),
    playlists: playlists.map((pl) => ({
      id: pl.id,
      name: pl.name,
      songs: (pl.songs || []).map(sanitizeTrackForPersistence).filter(Boolean),
    })),
  }
}

/** Validate and idempotently merge an exported JSON snapshot into local lists. */
export function importLibrarySnapshot(snapshot, { existingLiked = [], existingPlaylists = [] } = {}) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Invalid library backup file.')
  }
  const incomingLiked = Array.isArray(snapshot.liked)
    ? snapshot.liked.map(sanitizeTrackForPersistence).filter(Boolean)
    : []
  const incomingPlaylists = Array.isArray(snapshot.playlists) ? snapshot.playlists : []

  const seenLiked = new Set(existingLiked.map((s) => trackKey(s) || s.id))
  const nextLiked = [...existingLiked]
  for (const s of incomingLiked) {
    const k = trackKey(s) || s.id
    if (k && !seenLiked.has(k)) {
      seenLiked.add(k)
      nextLiked.push(s)
    }
  }

  const byName = new Map(existingPlaylists.map((p) => [String(p.name || '').toLowerCase(), p]))
  const nextPlaylists = [...existingPlaylists]
  for (const pl of incomingPlaylists) {
    if (!pl?.name) continue
    const key = String(pl.name).toLowerCase()
    const songs = Array.isArray(pl.songs) ? pl.songs.map(sanitizeTrackForPersistence).filter(Boolean) : []
    if (!byName.has(key)) {
      const created = { id: pl.id || `pl${Date.now()}_${nextPlaylists.length}`, name: pl.name, songs }
      byName.set(key, created)
      nextPlaylists.push(created)
    } else {
      const target = byName.get(key)
      const existingKeys = new Set(target.songs.map((s) => trackKey(s) || s.id))
      const mergedSongs = [...target.songs]
      for (const s of songs) {
        const sk = trackKey(s) || s.id
        if (sk && !existingKeys.has(sk)) {
          existingKeys.add(sk)
          mergedSongs.push(s)
        }
      }
      const idx = nextPlaylists.indexOf(target)
      if (idx >= 0) nextPlaylists[idx] = { ...target, songs: mergedSongs }
    }
  }

  return { liked: nextLiked, playlists: nextPlaylists }
}
