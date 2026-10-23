import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { store } from '../lib/storage.js'
import { decodeHtml } from '../lib/format.js'
import { artistsOf } from '../lib/song.js'
import { createSyncState, sanitizeTrackForPersistence, trackKey } from '../lib/models.js'
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

const MAX_LIKED = 300
const MAX_PL_SONGS = 500
const MAX_STAT_SONGS = 300

const MIRROR_KEY = 'svRemoteMirror'
const SYNC_STATE_KEY = 'svSyncState'
const ACCOUNT_KEY = 'svAccount'
const CONSENT_KEY = 'svSyncConsent'

function emptyStats() {
  return { plays: 0, seconds: 0, songs: {}, artists: {} }
}

export function LibraryProvider({ children, accountProvider = null }) {
  // Private session suppresses history, not playback. The taste model in
  // lib/taste.js reads this same store, so one flag covers both.
  const { privateSession } = useSettings()
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

  const mirrorRef = useRef(remoteMirror)
  const syncStateRef = useRef(syncState)
  mirrorRef.current = remoteMirror
  syncStateRef.current = syncState

  // Never persist raw expiring URLs or transient credentials in localStorage.
  useEffect(() => {
    store.setJSON(
      'svLiked',
      localLiked.map(sanitizeTrackForPersistence).filter(Boolean)
    )
  }, [localLiked])

  useEffect(() => {
    store.setJSON(
      'svPlaylists',
      localPlaylists.map((p) => ({
        ...p,
        songs: (p.songs || []).map(sanitizeTrackForPersistence).filter(Boolean),
      }))
    )
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
          msg = 'Playlist is full (500 songs).'
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

  const connectAccount = useCallback(
    async ({ collections = ['liked', 'playlists'] } = {}) => {
      if (!accountProvider) {
        throw new Error('No authorized AccountProvider is configured in this build.')
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

      return runLibrarySync({
        accountProvider,
        account: validAccount,
        consent: nextConsent,
        storage: syncStorage,
      })
    },
    [accountProvider, syncStorage]
  )

  const syncNow = useCallback(async () => {
    if (!accountProvider || !account || !consent?.granted) return null
    return runLibrarySync({
      accountProvider,
      account,
      consent,
      storage: syncStorage,
    })
  }, [accountProvider, account, consent, syncStorage])

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
  // Kept out of React state: it ticks every 10s and on every play, and nothing
  // renders from it except the Stats page, which reads on mount.
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
  }, [])

  /** Credit elapsed listening time to whatever is currently playing. */
  const flushStats = useCallback(() => {
    if (!statCur.current) return
    const sec = Math.min(3600, Math.round((Date.now() - statT0.current) / 1000))
    statT0.current = Date.now()
    if (sec <= 0) return
    // A private session still advances the internal clock so a later public
    // session does not inherit a huge, unattributed chunk of time.
    if (privateRef.current) return
    const st = loadStats()
    st.seconds += sec
    const entry = st.songs[statCur.current.id]
    if (entry) {
      entry.sec += sec
      // Recency is what makes "recent" mean something to the taste model.
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
      }
      statT0.current = Date.now()
      if (privateRef.current) return
      const st = loadStats()
      st.plays++
      // `dur` turns raw seconds into a completion ratio, and `last` is what
      // lib/taste.js decays against. Both are needed to weight a skip below a
      // full listen; without them every play looks identical.
      const e = st.songs[song.id] || (st.songs[song.id] = { n: 0, sec: 0 })
      e.n++
      e.name = statCur.current.name
      e.artist = statCur.current.artist
      e.img = statCur.current.img
      e.dur = Number(song.duration) || e.dur || 0
      e.last = Date.now()
      e.artistId = statCur.current.artistId || e.artistId || null
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

  /**
   * Wipe the listening history. Deliberately narrow: likes and playlists are
   * the user's library, not a behavioural profile, and are left alone.
   */
  const resetHistory = useCallback(() => {
    statCur.current = null
    statT0.current = 0
    store.remove('svStats')
  }, [])

  /** Delete all local library collections, synced mirror copies, and account handles. */
  const deleteLocalLibrary = useCallback(async () => {
    if (accountProvider && typeof accountProvider.deleteAccountData === 'function') {
      try {
        await accountProvider.deleteAccountData()
      } catch {
        /* local wipe proceeds regardless */
      }
    }
    await disconnectAccount({ deleteMirror: true })
    setLocalLiked([])
    setLocalPlaylists([])
    store.remove('svLiked')
    store.remove('svPlaylists')
  }, [accountProvider, disconnectAccount])

  /** Find a song object by id anywhere we already hold one. */
  const resolveSong = useCallback(
    (id, queue = []) => {
      if (!id) return null
      return (
        queue.find((x) => x.id === id || trackKey(x) === id) ||
        liked.find((x) => x.id === id || trackKey(x) === id) ||
        playlists.reduce((f, p) => f || p.songs.find((x) => x.id === id || trackKey(x) === id), null) ||
        null
      )
    },
    [liked, playlists]
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
      renamePlaylist,
      deletePlaylist,
      addToPlaylist,
      removeFromPlaylist,
      remoteMirror,
      account,
      consent,
      syncState,
      conflicts,
      conflictPolicy,
      setConflictPolicy,
      hasAccountProvider: Boolean(accountProvider),
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
      renamePlaylist,
      deletePlaylist,
      addToPlaylist,
      removeFromPlaylist,
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
