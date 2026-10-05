import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { api } from '../lib/api.js'
import { decodeHtml } from '../lib/format.js'
import { artistsOf, effQ, streamOf } from '../lib/song.js'
import { useSettings } from './SettingsContext.jsx'
import { useLibrary } from './LibraryContext.jsx'
import { useStatus } from './StatusContext.jsx'

const Ctx = createContext(null)
export const usePlayer = () => useContext(Ctx)

const MANUAL_SKIP_FADE = 0.5
const RADIO_LOOKAHEAD = 4
const RADIO_BATCH = 5
const QUEUE_CAP = 120

/**
 * Owns playback. Two <audio> decks are held in refs and driven imperatively so
 * that a crossfade — which runs on a 50ms interval and touches both elements —
 * is never interrupted by a React re-render. Only the values the UI actually
 * paints (current index, play state, clock) live in state.
 */
export function PlayerProvider({ children }) {
  const settings = useSettings()
  const { statsOnPlay, flushStats } = useLibrary()
  const { setStatus } = useStatus()

  const [queue, setQueueState] = useState([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [clock, setClock] = useState({ cur: 0, dur: 0 })
  const [volume, setVolumeState] = useState(0.85)

  // --- decks ---
  const deckA = useRef(null)
  const deckB = useRef(null)
  const activeRef = useRef(null)
  const fadeTimer = useRef(null)
  const fadeOutEl = useRef(null)
  const baseVol = useRef(0.85)

  // --- web audio (live spectrum) ---
  const actx = useRef(null)
  const analyser = useRef(null)
  const freqData = useRef(null)

  // Mirrors so the imperative engine never reads a stale closure.
  const queueRef = useRef(queue)
  const idxRef = useRef(currentIndex)
  const setRef = useRef(settings)
  queueRef.current = queue
  idxRef.current = currentIndex
  setRef.current = settings

  // The decks are rendered below rather than built with `new Audio()`, so they
  // are inspectable in devtools and visible to the browser's media handling.
  useEffect(() => {
    if (!activeRef.current) activeRef.current = deckA.current
    ;[deckA.current, deckB.current].forEach((el) => {
      if (el) el.volume = baseVol.current
    })
  }, [])

  const active = () => activeRef.current || deckA.current
  const other = () => (activeRef.current === deckA.current ? deckB.current : deckA.current)

  const wantLive = useCallback(
    () => setRef.current.viz.on && setRef.current.viz.style === 'spectrum' && setRef.current.liveOK,
    []
  )

  const ensureGraph = useCallback(
    (el) => {
      if (!el || !wantLive() || el._graphDead) return
      try {
        if (!actx.current) {
          const AC = window.AudioContext || window.webkitAudioContext
          if (!AC) {
            setRef.current.setLiveOK(false)
            return
          }
          actx.current = new AC()
          analyser.current = actx.current.createAnalyser()
          analyser.current.fftSize = 256
          analyser.current.smoothingTimeConstant = 0.82
          freqData.current = new Uint8Array(analyser.current.frequencyBinCount)
          analyser.current.connect(actx.current.destination)
        }
        if (!el._src) {
          el._src = actx.current.createMediaElementSource(el)
          el._src.connect(analyser.current)
        }
        if (actx.current.state === 'suspended') actx.current.resume()
      } catch {
        setRef.current.setLiveOK(false)
      }
    },
    [wantLive]
  )

  // A deck must be marked crossorigin *before* it loads, or the analyser gets
  // silence from a tainted stream.
  const prepDeck = useCallback(
    (el) => {
      if (!el) return
      if (wantLive()) {
        el.setAttribute('crossorigin', 'anonymous')
        ensureGraph(el)
      } else {
        el.removeAttribute('crossorigin')
      }
    },
    [ensureGraph, wantLive]
  )

  const cancelFade = useCallback(() => {
    if (fadeTimer.current) {
      clearInterval(fadeTimer.current)
      fadeTimer.current = null
    }
    if (fadeOutEl.current) {
      try {
        fadeOutEl.current.pause()
      } catch {
        /* already detached */
      }
      fadeOutEl.current = null
    }
    try {
      active().volume = baseVol.current
    } catch {
      /* deck not ready */
    }
  }, [])

  /** Equal-power crossfade: sin/cos keeps perceived loudness flat through the overlap. */
  const startFade = useCallback(
    (outEl, inEl, durSec) => {
      cancelFade()
      if (!(durSec > 0.05)) {
        try {
          outEl.pause()
        } catch {
          /* ignore */
        }
        inEl.volume = baseVol.current
        inEl.play()?.catch(() => {})
        return
      }
      const steps = Math.max(2, Math.round(durSec * 20))
      let n = 0
      inEl.volume = 0
      inEl.play()?.catch(() => {})
      fadeOutEl.current = outEl
      fadeTimer.current = setInterval(() => {
        n++
        const t = Math.min(1, n / steps)
        try {
          outEl.volume = Math.max(0, baseVol.current * Math.cos((t * Math.PI) / 2))
          inEl.volume = Math.min(1, baseVol.current * Math.sin((t * Math.PI) / 2))
        } catch {
          /* ignore */
        }
        if (t >= 1) {
          clearInterval(fadeTimer.current)
          fadeTimer.current = null
          try {
            outEl.pause()
          } catch {
            /* ignore */
          }
          fadeOutEl.current = null
          try {
            inEl.volume = baseVol.current
          } catch {
            /* ignore */
          }
        }
      }, 50)
    },
    [cancelFade]
  )

  const radioBusy = useRef(false)
  const radioSeen = useRef(new Set())

  /** Keep an endless station topped up once the queue runs short. */
  const maybeRadioRefill = useCallback(async () => {
    const s = setRef.current
    if (!s.radio || radioBusy.current) return
    const q = queueRef.current
    const i = idxRef.current
    if (!q.length || i < 0) return
    if (q.length - 1 - i >= RADIO_LOOKAHEAD) return
    radioBusy.current = true
    try {
      const seed = q[q.length - 1]
      const aid = seed?.artists?.primary?.[0]?.id
      let cands = []
      if (aid) {
        try {
          const d = await api(`/artists/${aid}?songCount=20&albumCount=3`)
          cands = (d.topSongs || []).filter(
            (x) => x.downloadUrl?.length && !radioSeen.current.has(x.id) && !q.some((y) => y.id === x.id)
          )
        } catch {
          /* fall through to a plain search */
        }
      }
      if (cands.length < 3) {
        try {
          const q0 = artistsOf(seed).split(',')[0] || decodeHtml(seed.name)
          const d = await api(`/search/songs?query=${encodeURIComponent(q0)}&limit=20`)
          ;(d.results || []).forEach((x) => {
            if (
              x.downloadUrl?.length &&
              !radioSeen.current.has(x.id) &&
              !q.some((y) => y.id === x.id) &&
              !cands.some((c) => c.id === x.id)
            )
              cands.push(x)
          })
        } catch {
          /* offline — stop quietly */
        }
      }
      cands.sort(() => Math.random() - 0.5)
      const add = cands.slice(0, RADIO_BATCH)
      if (add.length) {
        add.forEach((x) => radioSeen.current.add(x.id))
        setQueueState((prev) => {
          let next = [...prev, ...add]
          // Trim history so a long station doesn't grow without bound.
          if (next.length > QUEUE_CAP && idxRef.current > 40) {
            next = next.slice(idxRef.current - 20)
            setCurrentIndex(20)
          }
          return next
        })
        setStatus(`📻 Radio added ${add.length} more song${add.length > 1 ? 's' : ''}.`)
      }
    } catch {
      /* silent */
    }
    radioBusy.current = false
  }, [setStatus])

  const afterStart = useCallback(
    (song) => {
      statsOnPlay(song)
      maybeRadioRefill()
    },
    [statsOnPlay, maybeRadioRefill]
  )

  /** Load track `i` onto the idle deck and crossfade into it. */
  const swapTo = useCallback(
    (i, durSec) => {
      const q = queueRef.current
      if (!q.length) return
      const idx = ((i % q.length) + q.length) % q.length
      const s = q[idx]
      const url = streamOf(s, effQ(s, setRef.current.qualityPref, setRef.current.dataSaver))
      if (!url) {
        setStatus('No stream URL for this song.', true)
        return
      }
      const outEl = active()
      const inEl = other()
      setCurrentIndex(idx)
      idxRef.current = idx
      prepDeck(inEl)
      inEl.src = url
      activeRef.current = inEl
      startFade(outEl, inEl, durSec)
      afterStart(s)
      setStatus(
        'Playing: ' + decodeHtml(s.name) + (durSec > 0.6 ? ` (crossfade ${durSec}s)` : '')
      )
    },
    [prepDeck, startFade, afterStart, setStatus]
  )

  const playTrack = useCallback(
    (i) => {
      const q = queueRef.current
      if (!q.length) return
      const el = active()
      // Already playing: hand over with a short fade instead of a hard cut.
      if (el.src && !el.paused) {
        swapTo(i, MANUAL_SKIP_FADE)
        return
      }
      cancelFade()
      const idx = ((i % q.length) + q.length) % q.length
      const s = q[idx]
      const url = streamOf(s, effQ(s, setRef.current.qualityPref, setRef.current.dataSaver))
      if (!url) {
        setStatus('No stream URL for this song.', true)
        return
      }
      setCurrentIndex(idx)
      idxRef.current = idx
      prepDeck(el)
      el.src = url
      el.volume = baseVol.current
      el.play().catch((e) => setStatus('Playback blocked: ' + e.message + ' (tap play)', true))
      afterStart(s)
      setStatus('Playing: ' + decodeHtml(s.name))
    },
    [cancelFade, prepDeck, swapTo, afterStart, setStatus]
  )

  const stopPlayback = useCallback(() => {
    cancelFade()
    try {
      active().pause()
      active().currentTime = 0
    } catch {
      /* ignore */
    }
    setIsPlaying(false)
    setStatus('End of queue — stopped.')
  }, [cancelFade, setStatus])

  const nextTrack = useCallback(() => {
    const q = queueRef.current
    if (!q.length) return
    const s = setRef.current
    if (s.shuffle && q.length > 1) {
      let n
      do {
        n = Math.floor(Math.random() * q.length)
      } while (n === idxRef.current)
      playTrack(n)
      return
    }
    if (idxRef.current >= q.length - 1 && s.repeat === 'off') {
      stopPlayback()
      return
    }
    playTrack(idxRef.current + 1)
  }, [playTrack, stopPlayback])

  const prevTrack = useCallback(() => {
    const q = queueRef.current
    if (!q.length) return
    const el = active()
    // Mirrors every other player: a second press within 3s goes back a track.
    if (el.currentTime > 3) {
      cancelFade()
      try {
        el.currentTime = 0
      } catch {
        /* ignore */
      }
    } else playTrack(idxRef.current - 1)
  }, [cancelFade, playTrack])

  /** Re-open the current stream at a new quality, holding the playhead. */
  const reloadActive = useCallback(() => {
    const el = active()
    if (idxRef.current < 0 || !el.src) return
    cancelFade()
    const s = queueRef.current[idxRef.current]
    const t = el.currentTime || 0
    const wasPlaying = !el.paused
    prepDeck(el)
    el.src = streamOf(s, effQ(s, setRef.current.qualityPref, setRef.current.dataSaver))
    el.volume = baseVol.current
    const restore = () => {
      try {
        if (isFinite(t) && t > 0) el.currentTime = t
      } catch {
        /* ignore */
      }
    }
    el.addEventListener('loadedmetadata', function h() {
      restore()
      el.removeEventListener('loadedmetadata', h)
    })
    if (wasPlaying) el.play()?.catch(() => {})
  }, [cancelFade, prepDeck])

  const togglePlay = useCallback(() => {
    if (idxRef.current < 0) {
      if (queueRef.current.length) playTrack(0)
      return
    }
    const el = active()
    if (el.paused) {
      ensureGraph(el)
      el.play()?.catch(() => {})
    } else {
      cancelFade()
      el.pause()
    }
  }, [cancelFade, ensureGraph, playTrack])

  const play = useCallback(() => {
    if (idxRef.current < 0) {
      if (queueRef.current.length) playTrack(0)
      return
    }
    const el = active()
    ensureGraph(el)
    el.play()?.catch(() => {})
  }, [ensureGraph, playTrack])

  const seekTo = useCallback((seconds) => {
    cancelFade()
    const el = active()
    if (idxRef.current < 0) return
    try {
      el.currentTime = Math.max(0, seconds)
    } catch {
      /* ignore */
    }
  }, [cancelFade])

  const pause = useCallback(() => {
    cancelFade()
    try {
      active().pause()
    } catch {
      /* ignore */
    }
  }, [cancelFade])

  const seekFrac = useCallback((frac) => {
    cancelFade()
    const el = active()
    const q = queueRef.current
    const tot = (isFinite(el.duration) && el.duration) || q[idxRef.current]?.duration
    if (tot && idxRef.current >= 0) {
      try {
        el.currentTime = tot * Math.min(1, Math.max(0, frac))
      } catch {
        /* ignore */
      }
    }
  }, [cancelFade])

  const seekBy = useCallback((delta) => {
    const el = active()
    if (idxRef.current < 0) return
    try {
      el.currentTime = Math.max(0, Math.min(el.duration || 1e9, el.currentTime + delta))
    } catch {
      /* ignore */
    }
  }, [])

  const setVolume = useCallback((v) => {
    baseVol.current = v
    setVolumeState(v)
    if (!fadeTimer.current) {
      try {
        active().volume = v
      } catch {
        /* ignore */
      }
    }
  }, [])

  // --- deck event wiring ---
  useEffect(() => {
    const decks = [deckA.current, deckB.current].filter(Boolean)
    if (!decks.length) return

    const onPlay = (e) => e.target === active() && setIsPlaying(true)
    const onPause = (e) => e.target === active() && setIsPlaying(false)

    const onTime = (e) => {
      if (e.target !== active()) return
      const el = active()
      const s = setRef.current
      const q = queueRef.current
      const dur = (isFinite(el.duration) && el.duration) || 0
      const cur = el.currentTime || 0
      const tot = dur || q[idxRef.current]?.duration || 0
      setClock({ cur, dur: tot })

      // Begin the overlap early enough that the outgoing track ends silent.
      const remain = dur ? dur - cur : -1
      const atEnd = idxRef.current >= q.length - 1 && s.repeat === 'off'
      if (
        s.crossfade.on &&
        s.repeat !== 'one' &&
        !atEnd &&
        !fadeTimer.current &&
        !el.paused &&
        remain > 0.25 &&
        remain <= s.crossfade.dur &&
        q.length > 1
      ) {
        swapTo(idxRef.current + 1, Math.min(s.crossfade.dur, Math.max(0.6, remain - 0.1)))
      }
    }

    const onEnded = (e) => {
      if (e.target !== active()) return
      const s = setRef.current
      const el = active()
      if (s.repeat === 'one') {
        cancelFade()
        try {
          el.currentTime = 0
        } catch {
          /* ignore */
        }
        el.play()?.catch(() => {})
        return
      }
      if (idxRef.current >= queueRef.current.length - 1 && s.repeat === 'off') {
        stopPlayback()
        return
      }
      swapTo(idxRef.current + 1, s.crossfade.on ? s.crossfade.dur : 0)
    }

    const onError = (e) => {
      const el = e.target
      if (el !== active()) return
      // A CDN without CORS headers taints the deck. Drop the analyser, reload
      // the same stream without crossorigin, and keep the music going.
      if (el.hasAttribute('crossorigin') && !el._corsFix) {
        el._corsFix = true
        setRef.current.setLiveOK(false)
        if (el._src) {
          try {
            el._src.disconnect()
          } catch {
            /* ignore */
          }
          el._graphDead = true
        }
        const src = el.src
        const t = el.currentTime || 0
        const wasPlaying = !el.paused
        el.removeAttribute('crossorigin')
        el.src = src
        el.addEventListener('loadedmetadata', function h() {
          try {
            if (t > 0) el.currentTime = t
          } catch {
            /* ignore */
          }
          el.removeEventListener('loadedmetadata', h)
        })
        if (wasPlaying) el.play()?.catch(() => {})
        setStatus('Live spectrum blocked — visualizer switched to simulated mode. Music continues.')
        return
      }
      setStatus('Stream error — skipping to next…', true)
      setTimeout(() => {
        if (active() === el) nextTrack()
      }, 900)
    }

    decks.forEach((el) => {
      el.addEventListener('play', onPlay)
      el.addEventListener('pause', onPause)
      el.addEventListener('timeupdate', onTime)
      el.addEventListener('ended', onEnded)
      el.addEventListener('error', onError)
      el.volume = baseVol.current
    })
    return () => {
      decks.forEach((el) => {
        el.removeEventListener('play', onPlay)
        el.removeEventListener('pause', onPause)
        el.removeEventListener('timeupdate', onTime)
        el.removeEventListener('ended', onEnded)
        el.removeEventListener('error', onError)
      })
    }
  }, [swapTo, cancelFade, stopPlayback, nextTrack, setStatus])

  // Credit listening time periodically, not just on track change.
  useEffect(() => {
    const t = setInterval(() => {
      if (idxRef.current >= 0 && !active().paused) flushStats()
    }, 10000)
    return () => clearInterval(t)
  }, [flushStats])

  useEffect(() => {
    return () => {
      if (fadeTimer.current) clearInterval(fadeTimer.current)
      ;[deckA.current, deckB.current].forEach((el) => {
        try {
          el?.pause()
        } catch {
          /* ignore */
        }
      })
    }
  }, [])

  // --- queue operations ---
  const setQueue = useCallback((list, { play = null } = {}) => {
    setQueueState(list)
    queueRef.current = list
    if (play === null) {
      setCurrentIndex(-1)
      idxRef.current = -1
    }
  }, [])

  const playFromList = useCallback(
    (list, i) => {
      setQueueState(list)
      queueRef.current = list
      playTrack(i)
    },
    [playTrack]
  )

  const resetNowPlaying = useCallback(() => {
    cancelFade()
    try {
      const el = active()
      el.pause()
      el.removeAttribute('src')
      el.load()
    } catch {
      /* ignore */
    }
    setCurrentIndex(-1)
    idxRef.current = -1
    setIsPlaying(false)
    setClock({ cur: 0, dur: 0 })
  }, [cancelFade])

  const qMove = useCallback((i, dir) => {
    setQueueState((prev) => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      queueRef.current = next
      return next
    })
    setCurrentIndex((ci) => {
      const j = i + dir
      if (j < 0) return ci
      const n = ci === i ? j : ci === j ? i : ci
      idxRef.current = n
      return n
    })
  }, [])

  const qRemove = useCallback(
    (i) => {
      const prev = queueRef.current
      if (i < 0 || i >= prev.length) return
      const wasCurrent = i === idxRef.current
      const next = prev.filter((_, k) => k !== i)
      setQueueState(next)
      queueRef.current = next
      if (wasCurrent) {
        if (!next.length) {
          resetNowPlaying()
          return
        }
        swapTo(Math.min(i, next.length - 1), 0.4)
      } else if (i < idxRef.current) {
        const n = idxRef.current - 1
        idxRef.current = n
        setCurrentIndex(n)
      }
    },
    [resetNowPlaying, swapTo]
  )

  const qClear = useCallback(() => {
    const prev = queueRef.current
    const i = idxRef.current
    if (i >= 0 && prev[i]) {
      const next = [prev[i]]
      setQueueState(next)
      queueRef.current = next
      setCurrentIndex(0)
      idxRef.current = 0
      setStatus('Queue cleared — kept current song.')
    } else {
      setQueueState([])
      queueRef.current = []
      setCurrentIndex(-1)
      idxRef.current = -1
      setStatus('Queue cleared.')
    }
  }, [setStatus])

  const startRadioFrom = useCallback(
    (song) => {
      if (!song) {
        setStatus("Couldn't find that song for radio.", true)
        return
      }
      radioSeen.current = new Set([song.id])
      setQueueState([song])
      queueRef.current = [song]
      settings.setRadio(true)
      setStatus("📻 Radio on — I'll keep similar songs coming.")
      playTrack(0)
    },
    [playTrack, settings, setStatus]
  )

  const startArtistRadio = useCallback(
    (songs) => {
      if (!songs.length) return
      radioSeen.current = new Set(songs.map((s) => s.id))
      setQueueState([...songs])
      queueRef.current = [...songs]
      settings.setRadio(true)
      playTrack(0)
    },
    [playTrack, settings]
  )

  const current = currentIndex >= 0 ? queue[currentIndex] || null : null
  const currentQuality = current
    ? effQ(current, settings.qualityPref, settings.dataSaver)
    : settings.dataSaver
      ? '12kbps'
      : settings.qualityPref

  const value = useMemo(
    () => ({
      queue, currentIndex, current, isPlaying, clock, volume, currentQuality,
      setQueue, playFromList, playTrack, nextTrack, prevTrack, togglePlay, play, pause,
      seekFrac, seekBy, seekTo, setVolume, reloadActive, qMove, qRemove, qClear,
      startRadioFrom, startArtistRadio, resetNowPlaying,
      analyserRef: analyser, freqDataRef: freqData,
      audioRef: activeRef,
    }),
    [
      queue, currentIndex, current, isPlaying, clock, volume, currentQuality,
      setQueue, playFromList, playTrack, nextTrack, prevTrack, togglePlay, play, pause,
      seekFrac, seekBy, seekTo, setVolume, reloadActive, qMove, qRemove, qClear,
      startRadioFrom, startArtistRadio, resetNowPlaying,
    ]
  )

  return (
    <Ctx.Provider value={value}>
      {children}
      <audio ref={deckA} preload="metadata" />
      <audio ref={deckB} preload="metadata" />
    </Ctx.Provider>
  )
}
