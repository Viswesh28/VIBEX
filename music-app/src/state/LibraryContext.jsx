import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { store } from '../lib/storage.js'
import { decodeHtml } from '../lib/format.js'
import { artistsOf } from '../lib/song.js'

const Ctx = createContext(null)
export const useLibrary = () => useContext(Ctx)

const MAX_LIKED = 300
const MAX_PL_SONGS = 500
const MAX_STAT_SONGS = 300

function emptyStats() {
  return { plays: 0, seconds: 0, songs: {}, artists: {} }
}

export function LibraryProvider({ children }) {
  const [liked, setLiked] = useState(() => {
    const v = store.getJSON('svLiked', [])
    return Array.isArray(v) ? v : []
  })
  const [playlists, setPlaylists] = useState(() => {
    const v = store.getJSON('svPlaylists', [])
    return Array.isArray(v) ? v : []
  })

  useEffect(() => {
    store.setJSON('svLiked', liked)
  }, [liked])
  useEffect(() => {
    store.setJSON('svPlaylists', playlists)
  }, [playlists])

  const likedIds = useMemo(() => new Set(liked.map((s) => s.id)), [liked])

  const toggleLike = useCallback((song) => {
    if (!song) return
    setLiked((prev) => {
      const i = prev.findIndex((s) => s.id === song.id)
      if (i >= 0) return prev.filter((s) => s.id !== song.id)
      return [song, ...prev].slice(0, MAX_LIKED)
    })
  }, [])

  // ---- playlists ----
  const createPlaylist = useCallback((name, song) => {
    let error = null
    setPlaylists((prev) => {
      if (prev.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        error = 'A playlist with that name already exists.'
        return prev
      }
      return [{ id: 'pl' + Date.now(), name, songs: song ? [song] : [] }, ...prev]
    })
    return error
  }, [])

  const renamePlaylist = useCallback((id, name) => {
    setPlaylists((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)))
  }, [])

  const deletePlaylist = useCallback((id) => {
    setPlaylists((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const addToPlaylist = useCallback((id, song) => {
    let msg = null
    setPlaylists((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p
        if (p.songs.some((s) => s.id === song.id)) {
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
    setPlaylists((prev) =>
      prev.map((p) => (p.id === id ? { ...p, songs: p.songs.filter((s) => s.id !== songId) } : p))
    )
  }, [])

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
    const st = loadStats()
    st.seconds += sec
    if (st.songs[statCur.current.id]) st.songs[statCur.current.id].sec += sec
    const an = (statCur.current.artist.split(',')[0] || 'Unknown').trim() || 'Unknown'
    if (st.artists[an]) st.artists[an].sec += sec
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
      }
      statT0.current = Date.now()
      const st = loadStats()
      st.plays++
      const e = st.songs[song.id] || (st.songs[song.id] = { n: 0, sec: 0 })
      e.n++
      e.name = statCur.current.name
      e.artist = statCur.current.artist
      e.img = statCur.current.img
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

  /** Find a song object by id anywhere we already hold one. */
  const resolveSong = useCallback(
    (id, queue = []) => {
      if (!id) return null
      return (
        queue.find((x) => x.id === id) ||
        liked.find((x) => x.id === id) ||
        playlists.reduce((f, p) => f || p.songs.find((x) => x.id === id), null) ||
        null
      )
    },
    [liked, playlists]
  )

  const value = useMemo(
    () => ({
      liked, likedIds, toggleLike,
      playlists, createPlaylist, renamePlaylist, deletePlaylist, addToPlaylist, removeFromPlaylist,
      loadStats, statsOnPlay, flushStats, resolveSong,
    }),
    [
      liked, likedIds, toggleLike, playlists, createPlaylist, renamePlaylist, deletePlaylist,
      addToPlaylist, removeFromPlaylist, loadStats, statsOnPlay, flushStats, resolveSong,
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
