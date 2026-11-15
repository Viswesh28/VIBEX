import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { store } from '../lib/storage.js'
import { decodeHtml } from '../lib/format.js'
import { artistsOf } from '../lib/song.js'
import { createSyncState, sanitizeTrackForPersistence, trackKey } from '../lib/models.js'
import {
  clearAllOfflineAudio,
  idbDelete,
  idbGet,
  idbSet,
  listOfflineTracks,
  pinTrackOffline,
  subscribeOfflineTracks,
  unpinTrackOffline,
} from '../lib/offlineStore.js'
import {
  CONFLICT_POLICY,
  SYNC_STATUS,
  emptyRemoteMirror,
  exportLibrarySnapshot,
  importLibrarySnapshot,
  mergeLibraryViews,
  requireSyncConsent,
  runLibrarySync,
  validateDelegatedSession,
} from '../lib/sync.js'
import { useSettings } from './SettingsContext.jsx'

const Ctx = createContext(null)
export const useLibrary = () => useContext(Ctx)

// Backed by IndexedDB (`vibex_storage_v3`), lifting the legacy 300-song localStorage ceiling.
const MAX_LIKED = 10_000
const MAX_PL_SONGS = 5_000
const MAX_STAT_SONGS = 2_000

const MIRROR_KEY = 'svRemoteMirror'
const SYNC_STATE_KEY = 'svSyncState'
const ACCOUNT_KEY = 'svAccount'
const CONSENT_KEY = 'svSyncConsent'

function emptyStats() {
  return { plays: 0, seconds: 0, songs: {}, artists: {} }
}

export function LibraryProvider({ children, accountProvider = null }) {
  const { privateSession, qualityPref, dataSaver } = useSettings()
  const privateRef = useRef(false)
  privateRef.current = privateSession

  const [localLiked, setLocalLiked] = useState(() => {
    const v = store.getJSON('svLiked', [])
    return Array.isArray(v) ? v : []
  })
  const [localPlaylists, setLocalPlaylists] = useState(() => {
    const v = store.getJSON('svPlaylists', [])
    return Array.isArray(v) ? v : []
  })
  const [remoteMirror, setRemoteMirror] = useState(() => {
    const v = store.getJSON(MIRROR_KEY, null)
    return v && typeof v === 'object' ? v : emptyRemoteMirror()
  })
  const [account, setAccount] = useState(() => store.getJSON(ACCOUNT_KEY, null))
  const [consent, setConsent] = useState(() => store.getJSON(CONSENT_KEY, null))
  const [syncState, setSyncState] = useState(() => store.getJSON(SYNC_STATE_KEY, null))
  const [conflictPolicy, setConflictPolicy] = useState(CONFLICT_POLICY.keepBoth)
  const [offlineTracks, setOfflineTracks] = useState([])
  const [offlineBusyIds, setOfflineBusyIds] = useState(() => new Set())

  const mirrorRef = useRef(remoteMirror)
  const syncStateRef = useRef(syncState)
  mirrorRef.current = remoteMirror
  syncStateRef.current = syncState

  // Hydrate unlimited IndexedDB collections on mount if larger than the localStorage mirror.
  useEffect(() => {
    let alive = true
    Promise.all([idbGet('svLiked'), idbGet('svPlaylists')]).then(([idbLiked, idbPlaylists]) => {
      if (!alive) return
      if (Array.isArray(idbLiked) && idbLiked.length > localLiked.length) {
        setLocalLiked(idbLiked)
      }
      if (Array.isArray(idbPlaylists) && idbPlaylists.length > localPlaylists.length) {
        setLocalPlaylists(idbPlaylists)
      }
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Subscribe to pinned offline tracks so UI indicators & storage meters update live.
  useEffect(() => {
    let alive = true
    listOfflineTracks().then((items) => {
      if (alive) setOfflineTracks(items)
    })
    const unsub = subscribeOfflineTracks((items) => {
      if (alive) setOfflineTracks(items)
    })
    return () => {
      alive = false
      unsub()
    }
  }, [])

  // Persist sanitized collections to both IndexedDB (unlimited) and compact localStorage mirror.
  useEffect(() => {
    const clean = localLiked.map(sanitizeTrackForPersistence).filter(Boolean)
    idbSet('svLiked', clean)
    store.setJSON('svLiked', clean.slice(0, 400))
  }, [localLiked])

  useEffect(() => {
    const clean = localPlaylists.map((p) => ({
      ...p,
      songs: (p.songs || []).map(sanitizeTrackForPersistence).filter(Boolean),
    }))
    idbSet('svPlaylists', clean)
    store.setJSON('svPlaylists', clean)
  }, [localPlaylists])

  const merged = useMemo(
    () =>
      mergeLibraryViews({
        localLiked,
        localPlaylists,
        remoteMirror,
        conflictPolicy,
      }),
    [localLiked, localPlaylists, remoteMirror, conflictPolicy]
  )

  const liked = merged.liked
  const playlists = merged.playlists
  const conflicts = merged.conflicts

  const likedIds = useMemo(() => {
    const ids = new Set()
    for (const s of liked) {
      if (s?.id) ids.add(s.id)
      const k = trackKey(s)
      if (k) ids.add(k)
    }
    return ids
  }, [liked])

  const offlineIds = useMemo(() => new Set(offlineTracks.map((t) => t.id)), [offlineTracks])
  const offlineBytes = useMemo(
    () => offlineTracks.reduce((sum, item) => sum + (Number(item.size) || 0), 0),
    [offlineTracks]
  )

  const toggleOfflinePin = useCallback(
    async (song) => {
      if (!song?.id) return false
      if (offlineIds.has(song.id)) {
        await unpinTrackOffline(song.id)
        return false
      }
      setOfflineBusyIds((prev) => new Set(prev).add(song.id))
      try {
        await pinTrackOffline(song, { qualityPref, dataSaver })
        return true
      } finally {
        setOfflineBusyIds((prev) => {
          const next = new Set(prev)
          next.delete(song.id)
          return next
        })
      }
    },
    [dataSaver, offlineIds, qualityPref]
  )

  const pinPlaylistOffline = useCallback(
    async (songs = []) => {
      let savedCount = 0
      for (const song of songs) {
        if (!song?.id || offlineIds.has(song.id)) {
          if (song?.id) savedCount += 1
          continue
        }
        setOfflineBusyIds((prev) => new Set(prev).add(song.id))
        try {
          await pinTrackOffline(song, { qualityPref, dataSaver })
          savedCount += 1
        } catch {
          /* continue pinning remaining songs */
        } finally {
          setOfflineBusyIds((prev) => {
            const next = new Set(prev)
            next.delete(song.id)
            return next
          })
        }
      }
      return savedCount
    },
    [dataSaver, offlineIds, qualityPref]
  )

  const clearOfflineDownloads = useCallback(async () => {
    await clearAllOfflineAudio()
  }, [])

  const toggleLike = useCallback((song) => {
    if (!song) return
    const targetKey = trackKey(song) || song.id
    setLocalLiked((prev) => {
      const i = prev.findIndex((s) => (trackKey(s) || s.id) === targetKey || s.id === song.id)
      if (i >= 0) return prev.filter((_, idx) => idx !== i)
      return [song, ...prev].slice(0, MAX_LIKED)
    })
  }, [])

  // ---- playlists ----
  const createPlaylist = useCallback((name, song) => {
    let error = null
    setLocalPlaylists((prev) => {
      if (prev.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        error = 'A playlist with that name already exists.'
        return prev
      }
      return [{ id: 'pl' + Date.now(), name, songs: song ? [song] : [] }, ...prev]
    })
    return error
  }, [])

  const saveSongsAsPlaylist = useCallback((rawName, songs = []) => {
    const cleanSongs = (songs || []).filter((s) => s?.id).slice(0, MAX_PL_SONGS)
    const baseName = String(rawName || 'Imported Playlist').trim() || 'Imported Playlist'
    const id = 'pl' + Date.now() + Math.floor(Math.random() * 1000)
    setLocalPlaylists((prev) => {
      const exists = prev.some((p) => p.name.toLowerCase() === baseName.toLowerCase())
      const finalName = exists ? `${baseName} (${prev.length + 1})` : baseName
      return [{ id, name: finalName, songs: cleanSongs }, ...prev]
    })
    return id
  }, [])

  const renamePlaylist = useCallback((id, name) => {
    setLocalPlaylists((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)))
  }, [])

  const deletePlaylist = useCallback((id) => {
    setLocalPlaylists((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const addToPlaylist = useCallback((id, song) => {
    let msg = null
    const songKey = trackKey(song) || song.id
    setLocalPlaylists((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p
        if (p.songs.some((s) => (trackKey(s) || s.id) === songKey || s.id === song.id)) {
          msg = `Already in "${decodeHtml(p.name)}".`
          return p
        }
        if (p.songs.length >= MAX_PL_SONGS) {
          msg = `Playlist is full (${MAX_PL_SONGS} songs).`
          return p
        }
        msg = `Added to "${decodeHtml(p.name)}".`
        return { ...p, songs: [...p.songs, song] }
      })
    )
    return msg
  }, [])

  const removeFromPlaylist = useCallback((id, songId) => {
    setLocalPlaylists((prev) =>
      prev.map((p) => (p.id === id ? { ...p, songs: p.songs.filter((s) => s.id !== songId) } : p))
    )
  }, [])

  // ---- opt-in account sync & local data controls ----
  const syncStorage = useMemo(
    () => ({
      readMirror: () => mirrorRef.current,
      writeMirror: (next) => {
        mirrorRef.current = next
        setRemoteMirror(next)
        store.setJSON(MIRROR_KEY, next)
      },
      readSyncState: () => syncStateRef.current,
      writeSyncState: (next) => {
        syncStateRef.current = next
        setSyncState(next)
        store.setJSON(SYNC_STATE_KEY, next)
      },
    }),
    []
  )

  // Auto-restore Magic Link callback or saved Supabase JWT session on boot.
  useEffect(() => {
    if (!accountProvider || typeof accountProvider.restoreSession !== 'function') return undefined
    let alive = true
    accountProvider.restoreSession().then((restoredAccount) => {
      if (!alive || !restoredAccount) return
      const nextConsent = consent?.granted
        ? consent
        : { granted: true, collections: ['liked', 'playlists'], grantedAt: Date.now() }
      setAccount(restoredAccount)
      setConsent(nextConsent)
      store.setJSON(ACCOUNT_KEY, restoredAccount)
      store.setJSON(CONSENT_KEY, nextConsent)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountProvider])

  const connectAccount = useCallback(
    async ({ collections = ['liked', 'playlists'], credentials = null } = {}) => {
      if (!accountProvider) {
        throw new Error('No authorized AccountProvider is configured in this build.')
      }
      if (credentials && typeof accountProvider.setPendingCredentials === 'function') {
        accountProvider.setPendingCredentials(credentials)
      }
      const nextConsent = { granted: true, collections, grantedAt: Date.now() }
      const validatedCollections = requireSyncConsent(nextConsent)
      const session = await accountProvider.signIn()
      const validAccount = validateDelegatedSession(session)

      setConsent(nextConsent)
      setAccount(validAccount)
      store.setJSON(CONSENT_KEY, nextConsent)
      store.setJSON(ACCOUNT_KEY, validAccount)

      const initialState = createSyncState({
        accountId: validAccount.accountId,
        collection: validatedCollections.join(','),
        status: SYNC_STATUS.idle,
      })
      syncStorage.writeSyncState(initialState)

      // Push current local additions first if provider supports bidirectional cloud storage.
      if (typeof accountProvider.pushLibrary === 'function' && (localLiked.length || localPlaylists.length)) {
        await accountProvider.pushLibrary({ liked: localLiked, playlists: localPlaylists }).catch(() => {})
      }

      return runLibrarySync({
        accountProvider,
        account: validAccount,
        consent: nextConsent,
        storage: syncStorage,
      })
    },
    [accountProvider, localLiked, localPlaylists, syncStorage]
  )

  const syncNow = useCallback(async () => {
    if (!accountProvider || !account || !consent?.granted) return null
    if (typeof accountProvider.pushLibrary === 'function') {
      await accountProvider.pushLibrary({ liked, playlists }).catch(() => {})
    }
    return runLibrarySync({
      accountProvider,
      account,
      consent,
      storage: syncStorage,
    })
  }, [accountProvider, account, consent, liked, playlists, syncStorage])

  // Auto-push local library mutations in the background when signed in & sync is active.
  useEffect(() => {
    if (
      !accountProvider ||
      typeof accountProvider.pushLibrary !== 'function' ||
      !account ||
      !consent?.granted ||
      syncState?.status === SYNC_STATUS.paused
    ) {
      return undefined
    }
    const timer = setTimeout(() => {
      accountProvider.pushLibrary({ liked, playlists }).catch(() => {})
    }, 1500)
    return () => clearTimeout(timer)
  }, [accountProvider, account, consent, liked, playlists, syncState?.status])

  const pauseSync = useCallback(() => {
    if (!account && !syncStateRef.current) return
    const next = createSyncState({
      accountId: syncStateRef.current?.accountId || account.accountId,
      collection: syncStateRef.current?.collection || 'liked,playlists',
      cursor: syncStateRef.current?.cursor || null,
      lastSuccessfulSyncAt: syncStateRef.current?.lastSuccessfulSyncAt || null,
      status: SYNC_STATUS.paused,
    })
    syncStorage.writeSyncState(next)
  }, [account, syncStorage])

  const resumeSync = useCallback(async () => {
    if (!account && !syncStateRef.current) return null
    const next = createSyncState({
      accountId: syncStateRef.current?.accountId || account.accountId,
      collection: syncStateRef.current?.collection || 'liked,playlists',
      cursor: syncStateRef.current?.cursor || null,
      lastSuccessfulSyncAt: syncStateRef.current?.lastSuccessfulSyncAt || null,
      status: SYNC_STATUS.idle,
    })
    syncStorage.writeSyncState(next)
    if (accountProvider && account && consent?.granted) {
      return runLibrarySync({
        accountProvider,
        account,
        consent,
        storage: syncStorage,
      })
    }
    return null
  }, [account, accountProvider, consent, syncStorage])

  const clearRemoteMirror = useCallback(() => {
    const empty = emptyRemoteMirror()
    mirrorRef.current = empty
    setRemoteMirror(empty)
    store.remove(MIRROR_KEY)
    if (syncStateRef.current) {
      const resetCursor = createSyncState({
        ...syncStateRef.current,
        cursor: null,
      })
      syncStorage.writeSyncState(resetCursor)
    }
  }, [syncStorage])

  const disconnectAccount = useCallback(
    async ({ deleteMirror = false } = {}) => {
      if (accountProvider && typeof accountProvider.signOut === 'function') {
        try {
          await accountProvider.signOut()
        } catch {
          /* local revocation still proceeds */
        }
      }
      setAccount(null)
      setConsent(null)
      syncStateRef.current = null
      setSyncState(null)
      store.remove(ACCOUNT_KEY)
      store.remove(CONSENT_KEY)
      store.remove(SYNC_STATE_KEY)
      if (deleteMirror) clearRemoteMirror()
    },
    [accountProvider, clearRemoteMirror]
  )

  const exportLibrary = useCallback(
    () => exportLibrarySnapshot({ liked, playlists }),
    [liked, playlists]
  )

  const downloadLibraryExport = useCallback(() => {
    const snapshot = exportLibrarySnapshot({ liked, playlists })
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `vibex-library-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return snapshot
  }, [liked, playlists])

  const importLibrary = useCallback((snapshot) => {
    const res = importLibrarySnapshot(snapshot, {
      existingLiked: localLiked,
      existingPlaylists: localPlaylists,
    })
    setLocalLiked(res.liked.slice(0, MAX_LIKED))
    setLocalPlaylists(res.playlists)
    return res
  }, [localLiked, localPlaylists])

  // ---- listening stats ----
  const statCur = useRef(null)
  const statT0 = useRef(0)

  const loadStats = useCallback(() => {
    const s = store.getJSON('svStats', null)
    return s && typeof s === 'object' && s.songs ? s : emptyStats()
  }, [])

  const saveStats = useCallback((s) => {
    const keys = Object.keys(s.songs)
    if (keys.length > MAX_STAT_SONGS) {
      keys.sort((a, b) => s.songs[b].n + s.songs[b].sec / 60 - (s.songs[a].n + s.songs[a].sec / 60))
      keys.slice(MAX_STAT_SONGS).forEach((k) => delete s.songs[k])
    }
    store.setJSON('svStats', s)
    idbSet('svStats', s)
  }, [])

  const flushStats = useCallback(() => {
    if (!statCur.current) return
    const sec = Math.min(3600, Math.round((Date.now() - statT0.current) / 1000))
    statT0.current = Date.now()
    if (sec <= 0) return
    if (privateRef.current) return
    const st = loadStats()
    st.seconds += sec
    const entry = st.songs[statCur.current.id]
    if (entry) {
      entry.sec += sec
      entry.last = Date.now()
    }
    const an = (statCur.current.artist.split(',')[0] || 'Unknown').trim() || 'Unknown'
    if (st.artists[an]) {
      st.artists[an].sec += sec
      st.artists[an].last = Date.now()
    }
    saveStats(st)
  }, [loadStats, saveStats])

  const statsOnPlay = useCallback(
    (song) => {
      flushStats()
      if (!song) return
      statCur.current = {
        id: song.id,
        name: decodeHtml(song.name),
        artist: artistsOf(song),
        img: song.image?.length ? song.image[0].url : '',
        artistId: song.artists?.primary?.[0]?.id || null,
        songObj: sanitizeTrackForPersistence(song),
      }
      statT0.current = Date.now()
      if (privateRef.current) return
      const st = loadStats()
      st.plays++
      const e = st.songs[song.id] || (st.songs[song.id] = { n: 0, sec: 0 })
      e.n++
      e.name = statCur.current.name
      e.artist = statCur.current.artist
      e.img = statCur.current.img
      e.dur = Number(song.duration) || e.dur || 0
      e.last = Date.now()
      e.artistId = statCur.current.artistId || e.artistId || null
      if (statCur.current.songObj) e.song = statCur.current.songObj
      const an = (statCur.current.artist.split(',')[0] || 'Unknown').trim() || 'Unknown'
      const ae = st.artists[an] || (st.artists[an] = { n: 0, sec: 0 })
      ae.n++
      saveStats(st)
    },
    [flushStats, loadStats, saveStats]
  )

  useEffect(() => {
    window.addEventListener('beforeunload', flushStats)
    return () => window.removeEventListener('beforeunload', flushStats)
  }, [flushStats])

  const resetHistory = useCallback(() => {
    statCur.current = null
    statT0.current = 0
    store.remove('svStats')
    idbDelete('svStats')
  }, [])

  const deleteLocalLibrary = useCallback(async () => {
    if (accountProvider && typeof accountProvider.deleteAccountData === 'function') {
      try {
        await accountProvider.deleteAccountData()
      } catch {
        /* local wipe proceeds regardless */
      }
    }
    await disconnectAccount({ deleteMirror: true })
    await clearAllOfflineAudio()
    setLocalLiked([])
    setLocalPlaylists([])
    store.remove('svLiked')
    store.remove('svPlaylists')
    await idbDelete('svLiked')
    await idbDelete('svPlaylists')
  }, [accountProvider, disconnectAccount])

  const resolveSong = useCallback(
    (id, queue = []) => {
      if (!id) return null
      return (
        queue.find((x) => x.id === id || trackKey(x) === id) ||
        liked.find((x) => x.id === id || trackKey(x) === id) ||
        offlineTracks.find((x) => x.id === id || trackKey(x.song) === id)?.song ||
        playlists.reduce((f, p) => f || p.songs.find((x) => x.id === id || trackKey(x) === id), null) ||
        null
      )
    },
    [liked, offlineTracks, playlists]
  )

  const value = useMemo(
    () => ({
      liked,
      localLiked,
      likedIds,
      toggleLike,
      playlists,
      localPlaylists,
      createPlaylist,
      saveSongsAsPlaylist,
      renamePlaylist,
      deletePlaylist,
      addToPlaylist,
      removeFromPlaylist,
      offlineTracks,
      offlineIds,
      offlineBusyIds,
      offlineBytes,
      toggleOfflinePin,
      pinPlaylistOffline,
      clearOfflineDownloads,
      remoteMirror,
      account,
      consent,
      syncState,
      conflicts,
      conflictPolicy,
      setConflictPolicy,
      hasAccountProvider: Boolean(accountProvider),
      accountProvider,
      connectAccount,
      syncNow,
      pauseSync,
      resumeSync,
      disconnectAccount,
      clearRemoteMirror,
      exportLibrary,
      downloadLibraryExport,
      importLibrary,
      deleteLocalLibrary,
      loadStats,
      statsOnPlay,
      flushStats,
      resolveSong,
      resetHistory,
    }),
    [
      liked,
      localLiked,
      likedIds,
      toggleLike,
      playlists,
      localPlaylists,
      createPlaylist,
      saveSongsAsPlaylist,
      renamePlaylist,
      deletePlaylist,
      addToPlaylist,
      removeFromPlaylist,
      offlineTracks,
      offlineIds,
      offlineBusyIds,
      offlineBytes,
      toggleOfflinePin,
      pinPlaylistOffline,
      clearOfflineDownloads,
      remoteMirror,
      account,
      consent,
      syncState,
      conflicts,
      conflictPolicy,
      accountProvider,
      connectAccount,
      syncNow,
      pauseSync,
      resumeSync,
      disconnectAccount,
      clearRemoteMirror,
      exportLibrary,
      downloadLibraryExport,
      importLibrary,
      deleteLocalLibrary,
      loadStats,
      statsOnPlay,
      flushStats,
      resolveSong,
      resetHistory,
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
