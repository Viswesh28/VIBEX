/**
 * IndexedDB Storage & True In-App Offline Audio Vault (`vibex_offline_v3`).
 *
 * Removes localStorage's 5 MB / 300-song ceiling for libraries while letting
 * listeners pin songs & entire playlists for zero-network offline playback.
 * Transparently falls back to an in-memory vault in test environments where
 * `window.indexedDB` is absent.
 */

import { dlUrlFor, effQ } from './song.js'
import { sanitizeTrackForPersistence } from './models.js'

const DB_NAME = 'vibex_storage_v3'
const DB_VERSION = 1
const KV_STORE = 'library_kv'
const AUDIO_STORE = 'offline_audio'

const memKv = new Map()
const memAudio = new Map()
const activeBlobUrls = new Map()
const listeners = new Set()

let dbPromise = null
let cachedPinnedMeta = null

function notify() {
  cachedPinnedMeta = null
  listOfflineTracks().then((items) => {
    listeners.forEach((fn) => {
      try {
        fn(items)
      } catch {
        /* ignore */
      }
    })
  })
}

function hasIdb() {
  return typeof indexedDB !== 'undefined' && indexedDB !== null
}

function openDb() {
  if (!hasIdb()) return Promise.resolve(null)
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(KV_STORE)) {
          db.createObjectStore(KV_STORE)
        }
        if (!db.objectStoreNames.contains(AUDIO_STORE)) {
          db.createObjectStore(AUDIO_STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

export async function idbGet(key) {
  const db = await openDb()
  if (!db) return memKv.has(key) ? memKv.get(key) : undefined
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(KV_STORE, 'readonly')
      const req = tx.objectStore(KV_STORE).get(key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
}

export async function idbSet(key, value) {
  const db = await openDb()
  if (!db) {
    memKv.set(key, value)
    return true
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(KV_STORE, 'readwrite')
      tx.objectStore(KV_STORE).put(value, key)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}

export async function idbDelete(key) {
  const db = await openDb()
  if (!db) {
    memKv.delete(key)
    return
  }
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(KV_STORE, 'readwrite')
      tx.objectStore(KV_STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

export async function saveOfflineAudioBlob(song, blob, { quality = '320kbps', mimeType = '' } = {}) {
  if (!song?.id || !blob) throw new Error('Song and audio data are required.')
  const record = {
    id: song.id,
    song: sanitizeTrackForPersistence(song) || { id: song.id, name: song.name || 'Track' },
    blob,
    size: Number(blob.size) || 0,
    mimeType: mimeType || blob.type || 'audio/mp4',
    quality,
    savedAt: Date.now(),
  }

  const prevUrl = activeBlobUrls.get(song.id)
  if (prevUrl && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(prevUrl)
    activeBlobUrls.delete(song.id)
  }

  const db = await openDb()
  if (!db) {
    memAudio.set(song.id, record)
    notify()
    return record
  }
  await new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(AUDIO_STORE, 'readwrite')
      tx.objectStore(AUDIO_STORE).put(record)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('Failed to write offline audio'))
    } catch (e) {
      reject(e)
    }
  })
  notify()
  return record
}

/** Download a song's audio stream via `/api/dl` or `/api/ytaudio` and pin it in IndexedDB. */
export async function pinTrackOffline(
  song,
  { qualityPref = '320kbps', dataSaver = false, fetchFn = fetch } = {}
) {
  if (!song?.id) throw new Error('Cannot save invalid track offline.')
  const q = effQ(song, qualityPref, dataSaver)
  const downloadHref = dlUrlFor(song, q)
  if (!downloadHref || downloadHref === '#') {
    throw new Error('No downloadable stream available for this track.')
  }

  const res = await fetchFn(downloadHref)
  if (!res?.ok) {
    throw new Error(`Offline download failed (${res?.status || 'network'}).`)
  }
  const blob = await res.blob()
  if (!blob || blob.size === 0) {
    throw new Error('Downloaded audio stream was empty.')
  }
  const mimeType = (res.headers?.get?.('content-type') || blob.type || 'audio/mp4').split(';')[0]
  return saveOfflineAudioBlob(song, blob, { quality: q, mimeType })
}

export async function unpinTrackOffline(songId) {
  if (!songId) return
  const prevUrl = activeBlobUrls.get(songId)
  if (prevUrl && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(prevUrl)
    activeBlobUrls.delete(songId)
  }
  const db = await openDb()
  if (!db) {
    memAudio.delete(songId)
    notify()
    return
  }
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(AUDIO_STORE, 'readwrite')
      tx.objectStore(AUDIO_STORE).delete(songId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
  notify()
}

export async function clearAllOfflineAudio() {
  for (const url of activeBlobUrls.values()) {
    if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
  }
  activeBlobUrls.clear()
  memAudio.clear()
  const db = await openDb()
  if (db) {
    await new Promise((resolve) => {
      try {
        const tx = db.transaction(AUDIO_STORE, 'readwrite')
        tx.objectStore(AUDIO_STORE).clear()
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      } catch {
        resolve()
      }
    })
  }
  notify()
}

export async function getOfflineAudioEntry(songId) {
  if (!songId) return null
  const db = await openDb()
  if (!db) return memAudio.get(songId) || null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(AUDIO_STORE, 'readonly')
      const req = tx.objectStore(AUDIO_STORE).get(songId)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** Resolve a zero-network `blob:` object URL when `songId` is pinned offline. */
export async function resolveOfflinePlaybackUrl(songId) {
  if (!songId) return null
  const existing = activeBlobUrls.get(songId)
  if (existing) return existing
  const entry = await getOfflineAudioEntry(songId)
  if (!entry?.blob || typeof URL.createObjectURL !== 'function') return null
  const objUrl = URL.createObjectURL(entry.blob)
  activeBlobUrls.set(songId, objUrl)
  return objUrl
}

export async function listOfflineTracks() {
  if (cachedPinnedMeta) return cachedPinnedMeta
  const db = await openDb()
  if (!db) {
    const items = [...memAudio.values()]
      .map(({ id, song, size, quality, mimeType, savedAt }) => ({
        id,
        song,
        size,
        quality,
        mimeType,
        savedAt,
      }))
      .sort((a, b) => b.savedAt - a.savedAt)
    cachedPinnedMeta = items
    return items
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(AUDIO_STORE, 'readonly')
      const req = tx.objectStore(AUDIO_STORE).getAll()
      req.onsuccess = () => {
        const items = (req.result || [])
          .map(({ id, song, size, quality, mimeType, savedAt }) => ({
            id,
            song,
            size,
            quality,
            mimeType,
            savedAt,
          }))
          .sort((a, b) => b.savedAt - a.savedAt)
        cachedPinnedMeta = items
        resolve(items)
      }
      req.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

export function subscribeOfflineTracks(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
