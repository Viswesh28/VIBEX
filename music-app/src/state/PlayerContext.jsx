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
import { isYtTrack, playbackCopy, playbackPlan } from '../lib/sources.js'
import {
  forgetStream,
  invalidateStreams,
  mintYtStream,
  streamFailureCopy,
  streamMintBridge,
} from '../lib/ytStream.js'
import { isNative } from '../lib/config.js'
import { isIOS, preparePlaybackAudioSession } from '../lib/platform.js'
import { store } from '../lib/storage.js'
import {
  MANUAL_SKIP_SEC,
  fadeGains,
  normaliseLaw,
  planTransition,
  rampCurve,
} from '../lib/transition.js'
import {
  NEXT,
  REC_REASON,
  STOP_LABEL,
  decideNext,
  noteDismissed,
  pickCandidate,
  playedOutcome,
  pruneDismissed,
} from '../lib/recommend.js'
import {
  FAILURE,
  classifyMediaError,
  failureMessage,
  isExpired,
  nextQuality,
  parseExpiry,
} from '../lib/stream.js'
import { EVENTS, track as telemetry } from '../lib/telemetry.js'
import { buildTaste, rankByTaste, recentlyPlayedIds } from '../lib/taste.js'
import { useSettings } from './SettingsContext.jsx'
import { useLibrary } from './LibraryContext.jsx'
import { useStatus } from './StatusContext.jsx'

const Ctx = createContext(null)
export const usePlayer = () => useContext(Ctx)

const RADIO_LOOKAHEAD = 4
const RADIO_BATCH = 5
const QUEUE_CAP = 120
/** How many candidates to keep warm so a hand-over never waits on the network. */
const REC_POOL_MIN = 4
const DISMISSED_KEY = 'svDismissed'
const MIN_CROSSFADE_RUN = 0.06

// iOS reclaims backgrounded web apps aggressively. Persisting the queue means a
// relaunch from the home screen still shows what you were listening to — ready
// to resume with one tap — instead of an empty player.
const SESSION_KEY = 'svSession'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
// The playhead is stored separately from the queue: rewriting a 120-track
// queue every few seconds to save one number is a lot of localStorage churn.
const RESUME_KEY = 'svResume'
/**
 * The sleep fade rides on top of both other volume lanes: user volume and the
 * crossfade curve. One writer keeps the three from fighting — a ramp that the
 * next crossfade tick overwrites is not a fade, it is a glitch.
 */
function writeVol(el, frac, mul = 1) {
  if (!el) return
  try {
    const v = frac * mul
    el.volume = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
  } catch {
    /* deck detached */
  }
}

/** Below this a resume is not worth the seek. */
const RESUME_MIN_SEC = 5
const RESUME_TICK_MS = 5000

function readSavedSession() {
  const empty = { queue: [], index: -1 }
  const saved = store.getJSON(SESSION_KEY, null)
  if (!saved || !Array.isArray(saved.queue) || !saved.queue.length) return empty
  if (!saved.at || Date.now() - saved.at > SESSION_TTL_MS) return empty
  const queue = saved.queue.filter((song) => song && song.id)
  if (!queue.length) return empty
  const index =
    Number.isInteger(saved.index) && saved.index >= 0 && saved.index < queue.length
      ? saved.index
      : 0
  return { queue, index }
}

/**
 * The saved playhead, if — and only if — it belongs to the track that the
 * saved queue is sitting on. A stale id means the listener moved on: silently
 * seeking is worse than starting from zero.
 */
function readSavedPosition(songId) {
  if (!songId) return 0
  const saved = store.getJSON(RESUME_KEY, null)
  if (!saved || saved.id !== songId) return 0
  if (!saved.at || Date.now() - saved.at > SESSION_TTL_MS) return 0
  const pos = Number(saved.pos)
  if (!Number.isFinite(pos) || pos < RESUME_MIN_SEC) return 0
  const dur = Number(saved.dur)
  // A position at (or past) the end is a finished track, not a resume point.
  if (Number.isFinite(dur) && dur > 0 && pos >= dur - 2) return 0
  return pos
}

/**
 * Owns playback. Two <audio> decks are held in refs and driven imperatively so
 * that a crossfade — which runs on a 50ms interval and touches both elements —
 * is never interrupted by a React re-render. Only the values the UI actually
 * paints (current index, play state, clock) live in state.
 */
export function PlayerProvider({ children }) {
  const settings = useSettings()
  const { statsOnPlay, flushStats, loadStats } = useLibrary()
  const { setStatus } = useStatus()

  // Read once, before the first paint, so the restored track is in the very
  // first render rather than flashing "Nothing playing".
  const bootRef = useRef(null)
  if (bootRef.current === null) bootRef.current = readSavedSession()

  const [queue, setQueueState] = useState(() => bootRef.current.queue)
  const [currentIndex, setCurrentIndex] = useState(() => bootRef.current.index)
  const [isPlaying, setIsPlaying] = useState(false)
  const bootTrack = bootRef.current.index >= 0 ? bootRef.current.queue[bootRef.current.index] : null
  const bootPos = readSavedPosition(bootTrack?.id)
  // The UI should show the restored playhead before anything is loaded.
  const [clock, setClock] = useState(() =>
    bootPos > 0 ? { cur: bootPos, dur: Number(bootTrack?.duration) || 0 } : { cur: 0, dur: 0 }
  )
  const [volume, setVolumeState] = useState(0.85)
  // Transition truth, not a timer: the badge and the cover cross-fade read this.
  const [transition, setTransition] = useState({ state: 'idle', kind: null, reason: null, dur: 0 })
  const [stopReason, setStopReason] = useState(null)

  // --- decks ---
  const deckA = useRef(null)
  const deckB = useRef(null)
  const activeRef = useRef(null)
  const fadeTimer = useRef(null)
  const fadeOutEl = useRef(null)
  const baseVol = useRef(0.85)
  // Sleep fade multiplier. 1 = normal, 0 = silent. Read by every volume write
  // so a fade survives crossfades and volume changes.
  const sleepMul = useRef(1)
  // Element volume and crossfade gain are the same lane on <audio>; with a Web
  // Audio graph they are separate nodes. Keeping them apart is what stops a
  // "volume" change from bending the crossfade curve.
  const fadeStart = useRef(0)
  const fadeDur = useRef(0)
  const fadeLaw = useRef('equalPower')
  const fadeIdleTimer = useRef(null)

  // --- web audio (live spectrum) ---
  const actx = useRef(null)
  const analyser = useRef(null)
  const freqData = useRef(null)

  // Declared before the callbacks that read them (see the media-session work
  // below); `playingRef` is the authority on intent when iOS pauses us.
  const playingRef = useRef(false)
  const reloadRef = useRef(() => {})

  // Mirrors so the imperative engine never reads a stale closure.
  const queueRef = useRef(queue)
  const idxRef = useRef(currentIndex)
  const setRef = useRef(settings)
  // Recommendation state. The pool is warm before the queue needs it.
  const recPool = useRef([])
  const recBusy = useRef(false)
  const dismissed = useRef(
    pruneDismissed(store.getJSON(DISMISSED_KEY, {}))
  )
  const insertsUsed = useRef(0)
  const contextLength = useRef(0)
  const autoplayFailed = useRef(false)
  const radioFailed = useRef(false)
  const playedRec = useRef(null)
  const trackStart = useRef(0)
  // Where playback should resume on the next load, consumed once.
  const resumePos = useRef(bootPos)
  const resumeFor = useRef(bootPos > 0 ? bootTrack?.id || null : null)
  // Set once qRemove exists; dismissRecommendation is declared earlier than the
  // queue mutators it uses.
  const qRemoveRef = useRef(null)
  // Deck event listeners are wired once, so they reach the newest callbacks
  // through refs instead of re-subscribing on every render.
  const advanceRef = useRef(null)
  const resolveQualityRef = useRef(null)
  const advancing = useRef(false)
  // Per-track stream recovery attempts, reset whenever the track changes.
  const streamAttempts = useRef(0)
  const forcedQuality = useRef(null)
  queueRef.current = queue
  idxRef.current = currentIndex
  setRef.current = settings

  // Persist the queue (capped) and the current index. A relaunch restores the
  // track paused; nothing autoplays, which iOS would block anyway.
  useEffect(() => {
    if (!queue.length) {
      store.remove(SESSION_KEY)
      return
    }
    store.setJSON(SESSION_KEY, {
      queue: queue.slice(0, QUEUE_CAP),
      index: currentIndex,
      at: Date.now(),
    })
  }, [queue, currentIndex])

  // The decks are rendered below rather than built with `new Audio()`, so they
  // are inspectable in devtools and visible to the browser's media handling.
  useEffect(() => {
    if (!activeRef.current) activeRef.current = deckA.current
    ;[deckA.current, deckB.current].forEach((el) => {
      writeVol(el, baseVol.current, sleepMul.current)
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
          // A per-deck gain lane means the crossfade can be scheduled on the
          // audio clock instead of being approximated with element.volume.
          if (typeof actx.current.createGain === 'function') {
            el._xfade = actx.current.createGain()
            el._src.connect(el._xfade)
            el._xfade.connect(analyser.current)
          } else {
            el._src.connect(analyser.current)
          }
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

  const deckGain = useCallback((el) => {
    const g = el?._xfade?.gain
    return g && typeof g.setValueAtTime === 'function' ? g : null
  }, [])

  const resetDeckGain = useCallback(
    (el, value = 1) => {
      const g = deckGain(el)
      if (!g) return
      try {
        const t = actx.current?.currentTime ?? 0
        if (typeof g.cancelScheduledValues === 'function') g.cancelScheduledValues(t)
        g.value = value
      } catch {
        /* node detached */
      }
    },
    [deckGain]
  )

  const cancelFade = useCallback(() => {
    if (fadeTimer.current) {
      clearTimeout(fadeTimer.current)
      fadeTimer.current = null
    }
    if (fadeIdleTimer.current) {
      clearTimeout(fadeIdleTimer.current)
      fadeIdleTimer.current = null
    }
    if (fadeOutEl.current) {
      try {
        fadeOutEl.current.pause()
      } catch {
        /* already detached */
      }
      fadeOutEl.current = null
    }
    ;[deckA.current, deckB.current].forEach((el) => {
      if (!el) return
      resetDeckGain(el)
      try {
        writeVol(el, baseVol.current, sleepMul.current)
      } catch {
        /* deck not ready */
      }
    })
    setTransition((t) => (t.state === 'mixing' ? { ...t, state: 'idle' } : t))
  }, [resetDeckGain])

  const now = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()

  /**
   * Crossfade between the two decks.
   *
   * The curve comes from `fadeGains`, the clock is wall-clock elapsed time (so
   * a throttled timer can never bend the ramp), and where a Web Audio graph
   * exists the whole curve is scheduled ahead of time on the audio clock with
   * `setValueCurveAtTime`. Element volume is only the fallback path, because
   * <audio> has no automation lane.
   *
   * User volume and crossfade gain stay in separate lanes:
   *   - graph path: gain node = crossfade only, element volume = user volume
   *   - element path: element volume = user volume × crossfade gain
   */
  const startFade = useCallback(
    (outEl, inEl, durSec, lawOverride) => {
      cancelFade()
      const law = normaliseLaw(lawOverride || setRef.current.crossfade.law)
      const dur = Number.isFinite(Number(durSec)) ? Math.max(0, Number(durSec)) : 0
      const finish = () => {
        if (fadeTimer.current) {
          clearTimeout(fadeTimer.current)
          fadeTimer.current = null
        }
        try {
          outEl.pause()
        } catch {
          /* ignore */
        }
        fadeOutEl.current = null
        resetDeckGain(outEl)
        resetDeckGain(inEl)
        try {
          writeVol(inEl, baseVol.current, sleepMul.current)
        } catch {
          /* ignore */
        }
        // Let the "Mixing" badge linger for a beat, then clear the state.
        fadeIdleTimer.current = setTimeout(() => {
          fadeIdleTimer.current = null
          setTransition((t) => (t.state === 'mixing' ? { ...t, state: 'idle' } : t))
        }, 600)
      }

      // A cut is a real transition type, not a failed fade.
      if (!(dur > MIN_CROSSFADE_RUN)) {
        setTransition({ state: 'idle', kind: 'hard_cut', law: null, reason: null, dur: 0 })
        finish()
        try {
          writeVol(inEl, baseVol.current, sleepMul.current)
        } catch {
          /* ignore */
        }
        inEl.play()?.catch(() => {})
        return
      }

      fadeOutEl.current = outEl
      fadeStart.current = now()
      fadeDur.current = dur
      fadeLaw.current = law
      setTransition({ state: 'mixing', kind: 'crossfade', law, reason: null, dur })

      const outGain = deckGain(outEl)
      const inGain = deckGain(inEl)
      let scheduled = false
      if (outGain && inGain) {
        try {
          const t0 = actx.current?.currentTime ?? 0
          ;[outGain, inGain].forEach((g) => {
            if (typeof g.cancelScheduledValues === 'function') g.cancelScheduledValues(t0)
            if (typeof g.setValueAtTime === 'function') g.setValueAtTime(g.value, t0)
          })
          outGain.setValueCurveAtTime(rampCurve(law, 'out', 64), t0, dur)
          inGain.setValueCurveAtTime(rampCurve(law, 'in', 64), t0, dur)
          scheduled = true
        } catch {
          scheduled = false
        }
      }

      try {
        writeVol(outEl, baseVol.current, sleepMul.current)
        writeVol(inEl, scheduled ? baseVol.current : 0, sleepMul.current)
      } catch {
        /* ignore */
      }
      inEl.play()?.catch(() => {})

      const tick = () => {
        const elapsed = now() - fadeStart.current
        const e = fadeDur.current > 0 ? Math.min(1, elapsed / (fadeDur.current * 1000)) : 1
        if (!scheduled) {
          const g = fadeGains(fadeLaw.current, e)
          try {
            writeVol(outEl, baseVol.current * g.out, sleepMul.current)
            writeVol(inEl, baseVol.current * g.in, sleepMul.current)
          } catch {
            /* deck detached */
          }
        }
        if (e < 1) {
          fadeTimer.current = setTimeout(tick, 20)
          return
        }
        finish()
      }
      fadeTimer.current = setTimeout(tick, 20)
    },
    [cancelFade, deckGain, resetDeckGain]
  )

  const radioBusy = useRef(false)
  const radioSeen = useRef(new Set())
  const recSeed = useRef(null)
  const recWarm = useRef(null)

  /** Tag a queue copy with where it came from. User playlists never get this. */
  const withProv = (song, prov) => ({ ...song, _prov: prov })

  const persistDismissals = useCallback(() => {
    store.setJSON(DISMISSED_KEY, dismissed.current)
  }, [])

  /**
   * Ask the catalogue for songs like `seed`. Two cheap sources, best first:
   * the artist's own top songs, then a plain title search. Both are the same
   * data the radio already used; the ranking happens in pickCandidate.
   */
  const fetchCandidates = useCallback(async (seed) => {
    if (!seed) return []
    const out = []
    const aid = seed?.artists?.primary?.[0]?.id
    if (aid) {
      try {
        const d = await api(`/artists/${aid}?songCount=20&albumCount=3`)
        ;(d.topSongs || []).forEach((song) =>
          out.push({ song, reason: REC_REASON.sameArtist })
        )
      } catch {
        /* fall through to a plain search */
      }
    }
    if (out.length < REC_POOL_MIN) {
      try {
        const name = artistsOf(seed).split(',')[0] || decodeHtml(seed.name)
        const d = await api(`/search/songs?query=${encodeURIComponent(name)}&limit=20`)
        ;(d.results || []).forEach((song) =>
          out.push({ song, reason: REC_REASON.sameArtist })
        )
      } catch {
        /* offline — an empty pool is a valid answer */
      }
    }
    return out.filter(({ song }) => song?.downloadUrl?.length)
  }, [])

  /**
   * Keep the candidate pool warm. This is deliberately *not* on the critical
   * path: a hand-over should never wait for a network round-trip.
   */
  const ensureCandidates = useCallback(
    async (seed, { force = false } = {}) => {
      if (!seed?.id) return recPool.current
      if (!force && recSeed.current === seed.id && recPool.current.length >= REC_POOL_MIN)
        return recPool.current
      if (recBusy.current) return recPool.current
      recBusy.current = true
      try {
        const list = await fetchCandidates(seed)
        const taken = new Set([
          ...Object.keys(dismissed.current || {}),
          ...queueRef.current.map((x) => x.id),
          seed.id,
        ])
        const seen = new Set()
        recPool.current = list
          .filter(({ song }) => song?.id && !taken.has(song.id) && !seen.has(song.id))
          .filter(({ song }) => {
            seen.add(song.id)
            return true
          })
          .slice(0, 12)
        recSeed.current = seed.id
      } catch {
        /* offline */
      }
      recBusy.current = false
      return recPool.current
    },
    [fetchCandidates]
  )

  /** Pop the best candidate for `seed`, or null when the pool has nothing usable. */
  const takeCandidate = useCallback((seed) => {
    const songs = recPool.current.map((x) => x.song)
    const picked = pickCandidate(songs, {
      seed,
      dismissed: new Set(Object.keys(dismissed.current || {})),
      inQueue: new Set(queueRef.current.map((x) => x.id)),
    })
    if (!picked) return null
    const entry = recPool.current.find((x) => x.song.id === picked.id)
    recPool.current = recPool.current.filter((x) => x.song.id !== picked.id)
    return { song: picked, reason: entry?.reason || REC_REASON.sameArtist }
  }, [])

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
      if (!recPool.current.length) await ensureCandidates(seed, { force: true })
      const add = []
      while (add.length < RADIO_BATCH) {
        const picked = takeCandidate(seed)
        if (!picked) break
        radioSeen.current.add(picked.song.id)
        add.push(withProv(picked.song, { kind: 'autoplay', reason: picked.reason }))
      }
      if (add.length) {
        setQueueState((prev) => {
          let next = [...prev, ...add]
          // Trim history so a long station doesn't grow without bound.
          if (next.length > QUEUE_CAP && idxRef.current > 40) {
            next = next.slice(idxRef.current - 20)
            setCurrentIndex(20)
          }
          return next
        })
        setStatus(`Radio added ${add.length} more song${add.length > 1 ? 's' : ''}.`)
      }
    } catch {
      radioFailed.current = true
    }
    radioBusy.current = false
  }, [ensureCandidates, setStatus, takeCandidate])

  /**
   * Close the books on the track that is ending: an early skip of a
   * recommendation is a strong negative, an explicit dismiss is stronger, and
   * both are recorded rather than guessed at.
   */
  const settleOutgoing = useCallback(() => {
    const rec = playedRec.current
    if (!rec) return
    const sec = (now() - trackStart.current) / 1000
    const outcome = playedOutcome({ playedSec: sec, wasRecommendation: true })
    if (outcome.strongNegative) {
      dismissed.current = noteDismissed(dismissed.current, rec.id)
      persistDismissals()
      telemetry(EVENTS.recSkippedEarly, {
        songId: rec.id,
        kind: rec.kind,
        reason: rec.reason,
        playedSec: Math.round(sec),
      })
    } else if (outcome.success) {
      telemetry(EVENTS.recImpression, {
        songId: rec.id,
        kind: rec.kind,
        reason: rec.reason,
        playedSec: Math.round(sec),
      })
    }
    playedRec.current = null
  }, [persistDismissals])

  const afterStart = useCallback(
    (song) => {
      // A different track started, so a pending resume no longer applies.
      if (resumeFor.current && song?.id !== resumeFor.current) resumeFor.current = null
      settleOutgoing()
      trackStart.current = now()
      playedRec.current = song?._prov
        ? { id: song.id, kind: song._prov.kind, reason: song._prov.reason }
        : null
      statsOnPlay(song)
      setStopReason(null)
      autoplayFailed.current = false
      radioFailed.current = false
      // Warm the pool for the *next* hand-over while this one plays.
      if (song && (setRef.current.autoplay || setRef.current.smartShuffle)) {
        ensureCandidates(song)
      }
      maybeRadioRefill()
    },
    [ensureCandidates, maybeRadioRefill, settleOutgoing, statsOnPlay]
  )

  /** The transition settings, resolved into something swapTo can execute. */
  const handover = useCallback((manual) => {
    const s = setRef.current
    if (manual) {
      // Apple's rule, and the right one: a skip bypasses the fancy transition.
      return { dur: MANUAL_SKIP_SEC, law: s.crossfade.law, plan: null }
    }
    const plan = planTransition({
      crossfadeOn: s.crossfade.on,
      crossfadeSec: s.crossfade.on ? s.crossfade.dur : 0,
      law: s.crossfade.law,
    })
    telemetry(EVENTS.transitionPlanned, { type: plan.type, reason: plan.reason, law: plan.law })
    return { dur: plan.lengthSec, law: plan.law, plan }
  }, [])

  /**
   * Seek to the restored playhead — once, and only on the track it belongs to.
   * Guarding on the id matters: the listener can start a different song first,
   * and inheriting a stranger's position would be a bug, not a nice touch.
   */
  const armResume = useCallback((el, song) => {
    if (!el || !resumeFor.current || song?.id !== resumeFor.current) return
    const pos = resumePos.current
    resumeFor.current = null
    resumePos.current = 0
    if (!(pos > 0)) return
    const apply = () => {
      try {
        const dur = Number(el.duration)
        if (Number.isFinite(dur) && dur > 0 && pos >= dur - 2) return
        el.currentTime = pos
        setClock((c) => ({ ...c, cur: pos }))
      } catch {
        /* the stream refused the seek; starting at 0 is acceptable */
      }
    }
    if (el.readyState >= 1) apply()
    else
      el.addEventListener('loadedmetadata', function h() {
        el.removeEventListener('loadedmetadata', h)
        apply()
      })
  }, [])

  /** Write the playhead for the track that is playing right now. */
  const savePosition = useCallback(() => {
    const el = active()
    const song = queueRef.current[idxRef.current]
    if (!el || !song || !el.src) return
    const pos = Number(el.currentTime) || 0
    if (pos < RESUME_MIN_SEC) {
      store.remove(RESUME_KEY)
      return
    }
    store.setJSON(RESUME_KEY, {
      id: song.id,
      pos: Math.floor(pos),
      dur: Math.floor(Number(el.duration) || Number(song.duration) || 0),
      at: Date.now(),
    })
  }, [])

  /**
   * Why this track cannot play, in words the listener can act on.
   *
   * A YouTube Music result carries no stream, and the reason is a fact about
   * the deployment rather than a glitch — so it is named, with the way out,
   * instead of the old catch-all "No stream URL for this song."
   */
  const unplayableCopy = useCallback((song) => {
    const plan = playbackPlan(song, { native: isNative() })
    return playbackCopy(plan.reason) || 'This track has no stream to play.'
  }, [])

  /**
   * The only route to YouTube audio: mint it from a real page on this device.
   *
   * The server cannot, and says so (ADR 0001/0003); a WebView running YouTube's
   * own script can. `mintYtStream` owns the validity gate, so a URL that only
   * serves a preview never reaches the player — the failure comes back typed
   * and is shown as itself, not as a mid-song dropout.
   *
   * Returns the URL, or null after explaining why on the status line.
   */
  const mintUrl = useCallback(
    async (song) => {
      const bridge = streamMintBridge()
      if (!bridge) {
        // Native but no plugin: the plan's own refusal is the honest answer.
        setStatus(unplayableCopy(song), true)
        return null
      }
      const res = await mintYtStream({
        videoId: song?.videoId || String(song?.id || '').replace(/^yt:/, ''),
        bridge,
      })
      if (res.ok) return res.url
      telemetry(EVENTS.streamFailed, { songId: song?.id, reason: res.reason })
      setStatus(streamFailureCopy(res.reason) || unplayableCopy(song), true)
      return null
    },
    [setStatus, unplayableCopy]
  )


  const resolveQuality = useCallback((song) => {
    if (forcedQuality.current && song?.downloadUrl?.some((d) => d.quality === forcedQuality.current))
      return forcedQuality.current
    return effQ(song, setRef.current.qualityPref, setRef.current.dataSaver)
  }, [])

  useEffect(() => {
    resolveQualityRef.current = resolveQuality
  }, [resolveQuality])

  /** A YouTube track with no URL: mint, then continue on the same path. */
  const resolveUrl = useCallback(
    async (song) => {
      const url = streamOf(song, resolveQuality(song))
      if (url) return url
      if (!isYtTrack(song)) return null
      const plan = playbackPlan(song, { native: isNative() })
      if (!plan.willMint) return null
      return mintUrl(song)
    },
    [mintUrl, resolveQuality]
  )

  /** Load track `i` onto the idle deck and crossfade into it. */
  const swapTo = useCallback(
    (i, durSec, lawOverride) => {
      const q = queueRef.current
      if (!q.length) return
      const idx = ((i % q.length) + q.length) % q.length
      const s = q[idx]
      const finishSwap = (url) => {
        if (!url) return
        if (isExpired(url)) {
          telemetry(EVENTS.streamFailed, { songId: s.id, reason: FAILURE.staleUrl })
        }
        const outEl = active()
        const inEl = other()
        setCurrentIndex(idx)
        idxRef.current = idx
        streamAttempts.current = 0
        prepDeck(inEl)
        inEl.src = url
        activeRef.current = inEl
        startFade(outEl, inEl, durSec, lawOverride)
        afterStart(s)
        setStatus('Playing: ' + decodeHtml(s.name) + (durSec > 0.6 ? ` (${durSec.toFixed(1)}s blend)` : ''))
      };

      const direct = streamOf(s, resolveQuality(s))
      if (direct) {
        finishSwap(direct)
        return
      }
      const plan = playbackPlan(s, { native: isNative() })
      if (!plan.willMint) {
        setStatus(unplayableCopy(s), true)
        return
      }
      // A cold mint is 2–5 s, so the blend cannot start until it lands. The
      // queued track is announced while it waits rather than looking wedged.
      setStatus('Resolving ' + decodeHtml(s.name) + ' on this device…')
      resolveUrl(s).then(finishSwap)
    },
    [afterStart, prepDeck, resolveQuality, resolveUrl, setStatus, startFade, unplayableCopy]
  )

  const playTrack = useCallback(
    (i) => {
      const q = queueRef.current
      if (!q.length) return
      const el = active()
      // Already playing: hand over with a short fade instead of a hard cut.
      if (el.src && !el.paused) {
        swapTo(i, MANUAL_SKIP_SEC)
        return
      }
      cancelFade()
      const idx = ((i % q.length) + q.length) % q.length
      const s = q[idx]
      const start = (url) => {
        if (!url) return
        setCurrentIndex(idx)
        idxRef.current = idx
        streamAttempts.current = 0
        prepDeck(el)
        el.src = url
        writeVol(el, baseVol.current, sleepMul.current)
        resetDeckGain(el)
        armResume(el, s)
        el.play().catch((e) => setStatus('Playback blocked: ' + e.message + ' (tap play)', true))
        afterStart(s)
        setStatus('Playing: ' + decodeHtml(s.name))
      }

      const direct = streamOf(s, resolveQuality(s))
      if (direct) {
        start(direct)
        return
      }
      const plan = playbackPlan(s, { native: isNative() })
      if (!plan.willMint) {
        setStatus(unplayableCopy(s), true)
        return
      }
      setStatus('Resolving ' + decodeHtml(s.name) + ' on this device…')
      resolveUrl(s).then(start)
    },
    [afterStart, armResume, cancelFade, prepDeck, resetDeckGain, resolveQuality, resolveUrl, setStatus, swapTo, unplayableCopy]
  )

  const stopPlayback = useCallback(
    (reason = 'context_exhausted') => {
      playingRef.current = false
      cancelFade()
      try {
        active().pause()
        active().currentTime = 0
      } catch {
        /* ignore */
      }
      setIsPlaying(false)
      setStopReason(reason)
      if (reason === 'autoplay_failed') telemetry(EVENTS.autoplayFailed, { reason })
      // "Queue empty" and "the recommender had nothing" deserve different
      // sentences, because they need different recoveries.
      setStatus(`${STOP_LABEL[reason] || STOP_LABEL.unknown}.`, reason === 'autoplay_failed')
    },
    [cancelFade, setStatus]
  )

  /**
   * The single place the next track is chosen.
   *
   * The ladder — in context → smart insert → autoplay tail → radio → stop —
   * lives in recommend.js as a pure function. This callback only supplies the
   * signals and executes the plan, which is what keeps the decision testable.
   */
  const advance = useCallback(
    async ({ manual = false, len = null } = {}) => {
      // A hand-over can start before the previous one finished (a fast skip, a
      // timeupdate while a candidate fetch is in flight). One swap at a time.
      if (advancing.current) return
      advancing.current = true
      try {
        const q = queueRef.current
        if (!q.length) return
        const s = setRef.current
        const i = idxRef.current
        const seed = q[i] || q[q.length - 1]

        const wantsRec = s.autoplay || s.radio || s.smartShuffle
        let candidate = wantsRec ? takeCandidate(seed) : null
        if (!candidate && wantsRec) {
          await ensureCandidates(seed, { force: recPool.current.length === 0 })
          candidate = takeCandidate(seed)
        }

        const plan = decideNext({
          queueLength: q.length,
          index: i,
          repeat: s.repeat,
          shuffle: s.shuffleMode,
          smartShuffle: s.smartShuffle,
          autoplay: s.autoplay,
          radio: s.radio,
          insertsUsed: insertsUsed.current,
          originalLength: contextLength.current || q.length,
          candidate: candidate?.song || null,
          reason: candidate?.reason || REC_REASON.sameArtist,
          autoplayFailed: autoplayFailed.current,
          radioFailed: radioFailed.current,
        })

        const { dur: plannedDur, law } = handover(manual)
        const dur = Number.isFinite(len) ? Math.max(0, len) : plannedDur

        if (plan.kind === NEXT.inContext) {
          if (plan.shuffle) {
            if (q.length < 2) {
              swapTo(i, dur, law)
              return
            }
            let n = i
            do {
              n = Math.floor(Math.random() * q.length)
            } while (n === i)
            swapTo(n, dur, law)
            return
          }
          if (plan.loop) {
            const el = active()
            try {
              el.currentTime = 0
            } catch {
              /* ignore */
            }
            el.play()?.catch(() => {})
            return
          }
          if (plan.index === i && !plan.wrapped) return
          swapTo(plan.index, dur, law)
          return
        }

        if (plan.kind === NEXT.smartInsert || plan.kind === NEXT.autoplay || plan.kind === NEXT.radio) {
          const kind = plan.kind === NEXT.smartInsert ? 'smart_insert' : plan.kind
          const tagged = withProv(plan.item, { kind, reason: plan.reason })
          const at = i + 1
          const next = [...q.slice(0, at), tagged, ...q.slice(at)]
          setQueueState(next)
          queueRef.current = next
          if (plan.kind === NEXT.smartInsert) {
            insertsUsed.current += 1
            telemetry(EVENTS.recImpression, {
              songId: tagged.id,
              kind,
              reason: plan.reason,
              used: insertsUsed.current,
            })
            setStatus(
              `Added “${decodeHtml(tagged.name)}” — more from this artist.`
            )
          }
          swapTo(at, dur, law)
          return
        }
      } finally {
        advancing.current = false
      }
    },
    [ensureCandidates, handover, setStatus, stopPlayback, swapTo, takeCandidate]
  )

  const nextTrack = useCallback(() => {
    advance({ manual: true })
  }, [advance])

  useEffect(() => {
    advanceRef.current = advance
  }, [advance])

  /** Explicit negative feedback from the UI: never resurface this item today. */
  const dismissRecommendation = useCallback(
    (index) => {
      const q = queueRef.current
      const song = q[index]
      if (!song) return
      dismissed.current = noteDismissed(dismissed.current, song.id)
      persistDismissals()
      recPool.current = recPool.current.filter((x) => x.song.id !== song.id)
      telemetry(EVENTS.recDismissed, {
        songId: song.id,
        kind: song._prov?.kind || 'unknown',
        reason: song._prov?.reason || null,
      })
      setStatus('Got it — fewer suggestions like that.')
      // qRemove already knows how to hand over when the row is the current
      // track, so dismissal does not need its own playback path.
      qRemoveRef.current?.(index)
    },
    [persistDismissals, setStatus]
  )

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
    streamAttempts.current = 0
    const s = queueRef.current[idxRef.current]
    const t = el.currentTime || 0
    const wasPlaying = !el.paused

    const apply = (url) => {
      prepDeck(el)
      el.src = url
      writeVol(el, baseVol.current, sleepMul.current)
      el.addEventListener('loadedmetadata', function h() {
        // A re-minted URL is the *same file*, so the old position still means
        // the same thing in it — unlike a quality downgrade, where it does not.
        try {
          if (isFinite(t) && t > 0) el.currentTime = t
        } catch {
          /* ignore */
        }
        el.removeEventListener('loadedmetadata', h)
      })
      if (wasPlaying) el.play()?.catch(() => {})
    }

    // resolveQuality honours an automatic downgrade; using the raw preference
    // here would quietly undo the recovery on the next reload.
    const direct = streamOf(s, resolveQuality(s))
    if (direct) {
      apply(direct)
      return
    }

    // A minted URL that failed mid-stream is usually expired or IP-bound to a
    // network we have left. One re-mint is allowed; `mintYtStream` enforces it.
    if (!isYtTrack(s)) return
    const bridge = streamMintBridge()
    if (!bridge) return
    forgetStream(s.videoId || String(s.id || '').replace(/^yt:/, ''))
    mintYtStream({
      videoId: s.videoId || String(s.id || '').replace(/^yt:/, ''),
      bridge,
      force: true,
    }).then((res) => {
      if (res.ok) apply(res.url)
      else setStatus(streamFailureCopy(res.reason) || unplayableCopy(s), true)
    })
  }, [cancelFade, prepDeck, resolveQuality, setStatus, unplayableCopy])

  /**
   * A minted URL is bound to the address that minted it, so leaving Wi-Fi makes
   * every cached URL a 403 — before its `expire` says anything is wrong. Drop
   * them now rather than discovering it a track later.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const drop = () => invalidateStreams()
    const events = ['online', 'offline', 'focus']
    events.forEach((e) => window.addEventListener(e, drop))
    return () => events.forEach((e) => window.removeEventListener(e, drop))
  }, [])

  const togglePlay = useCallback(() => {
    if (idxRef.current < 0) {
      if (queueRef.current.length) playTrack(0)
      return
    }
    const el = active()
    if (el.paused) {
      // Restored from the last session: the deck has no source yet, so load
      // the restored track instead of calling play() on an empty element.
      if (!el.src) {
        playTrack(idxRef.current)
        return
      }
      ensureGraph(el)
      el.play()?.catch(() => reloadRef.current())
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
    if (!el.src) {
      playTrack(idxRef.current)
      return
    }
    ensureGraph(el)
    el.play()?.catch(() => reloadRef.current())
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

  /**
   * Resume from the Lock Screen / Control Center / Dynamic Island.
   *
   * iOS can tear the audio session down while a home-screen app sits paused or
   * backgrounded, in which case `play()` rejects against the existing source.
   * Re-opening the stream at the same playhead is what actually restarts
   * sound, so the system button keeps working instead of silently dying.
   */
  const resumeFromSystem = useCallback(async () => {
    const el = active()
    if (idxRef.current < 0) return
    if (!el.src) {
      playTrack(idxRef.current)
      return
    }
    try {
      await el.play()
    } catch {
      reloadRef.current()
    }
  }, [playTrack])

  /**
   * Returning to the app: iOS resets `navigator.audioSession.type` when the
   * page has been suspended, and a stream interrupted by a call or another
   * app can be left paused even though the UI still says playing. Re-assert
   * the playback session and, only if the user's intent was playing, resume.
   */
  useEffect(() => {
    preparePlaybackAudioSession()
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      preparePlaybackAudioSession()
      const el = active()
      if (!playingRef.current || idxRef.current < 0 || !el.src || !el.paused) return
      el.play()?.catch(() => reloadRef.current())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  /**
   * The sleep timer's volume lane. The hook calls this every 250ms through the
   * final SLEEP_FADE_SEC of the countdown, then with 1 once the timer is off —
   * a cancelled timer must hand the volume back, not leave it quiet.
   */
  const setSleepGain = useCallback((g) => {
    const mul = Number.isFinite(g) ? Math.max(0, Math.min(1, g)) : 1
    sleepMul.current = mul
    // Mid-crossfade the tick owns the writes; it reads sleepMul on each frame.
    if (!fadeTimer.current) {
      writeVol(active(), baseVol.current, mul)
      writeVol(other(), baseVol.current, mul)
    }
  }, [])

  /** Called when the listener picks a quality themselves. */
  const clearForcedQuality = useCallback(() => {
    forcedQuality.current = null
  }, [])

  const setVolume = useCallback((v) => {
    baseVol.current = v
    setVolumeState(v)
    if (!fadeTimer.current) {
      try {
        writeVol(active(), v, sleepMul.current)
      } catch {
        /* ignore */
      }
    }
  }, [])

  // Keep the recovery path pointing at the newest callback without making
  // every media-session effect depend on it.
  useEffect(() => {
    reloadRef.current = reloadActive
  }, [reloadActive])

  // --- deck event wiring ---
  useEffect(() => {
    const decks = [deckA.current, deckB.current].filter(Boolean)
    if (!decks.length) return

    const onPlay = (e) => {
      if (e.target !== active()) return
      playingRef.current = true
      setIsPlaying(true)
    }
    const onPause = (e) => {
      if (e.target !== active()) return
      playingRef.current = false
      setIsPlaying(false)
    }

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
        const plan = planTransition({
          a: { end: dur, tailSilence: 0 },
          b: { leadSilence: 0 },
          crossfadeOn: true,
          crossfadeSec: s.crossfade.dur,
          law: s.crossfade.law,
        })
        const len = plan.lengthSec > 0 ? Math.min(plan.lengthSec, Math.max(0.6, remain - 0.1)) : 0
        advanceRef.current?.({ manual: false, len })
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
      advanceRef.current?.({ manual: false })
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

      // --- typed recovery ladder -----------------------------------------
      // Decide *why* it failed before deciding what to do about it.
      const reason = classifyMediaError(e)
      const song = queueRef.current[idxRef.current]
      const available = song?.downloadUrl || []
      const urls = el.currentSrc || el.src
      const signed = parseExpiry(urls) != null
      telemetry(EVENTS.streamFailed, { songId: song?.id, reason })

      const attempt = streamAttempts.current
      streamAttempts.current += 1

      if (signed && isExpired(urls) && attempt < 2) {
        // A signed URL past its expiry needs a fresh one, not a retry.
        reloadRef.current()
        return
      }

      if (attempt < 1 && (reason === FAILURE.network || reason === FAILURE.aborted || reason === FAILURE.unknown)) {
        setStatus('Connection hiccup — retrying the stream…', true)
        try {
          el.load()
          el.play()?.catch(() => {})
        } catch {
          /* ignore */
        }
        return
      }

      const lower = nextQuality(available, resolveQualityRef.current?.(song))
      if (lower && lower !== forcedQuality.current) {
        forcedQuality.current = lower
        telemetry(EVENTS.streamRecovered, { songId: song?.id, action: 'downgrade', quality: lower })
        setStatus(`Stream trouble — dropping to ${lower}.`, true)
        reloadRef.current()
        return
      }

      setStatus(failureMessage(reason), true)
      setTimeout(() => {
        if (active() === el) advanceRef.current?.({ manual: false })
      }, 900)
    }

    decks.forEach((el) => {
      el.addEventListener('play', onPlay)
      el.addEventListener('pause', onPause)
      el.addEventListener('timeupdate', onTime)
      el.addEventListener('ended', onEnded)
      el.addEventListener('error', onError)
      writeVol(el, baseVol.current, sleepMul.current)
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

  // Persist the playhead on a slow tick, and immediately when the app is
  // backgrounded or closed — a phone kills the tab without warning.
  useEffect(() => {
    const t = setInterval(savePosition, RESUME_TICK_MS)
    const flush = () => savePosition()
    const onHide = () => {
      if (document.visibilityState === 'hidden') savePosition()
    }
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      clearInterval(t)
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [savePosition])

  // Credit listening time periodically, not just on track change.
  useEffect(() => {
    const t = setInterval(() => {
      if (idxRef.current >= 0 && !active().paused) flushStats()
    }, 10000)
    return () => clearInterval(t)
  }, [flushStats])

  useEffect(() => {
    return () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current)
      if (fadeIdleTimer.current) clearTimeout(fadeIdleTimer.current)
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
  /**
   * A new context resets the recommendation budget and the pool: insertions
   * are budgeted per playlist, not per session.
   */
  const resetContext = useCallback((list) => {
    contextLength.current = list.length
    insertsUsed.current = 0
    autoplayFailed.current = false
    radioFailed.current = false
    recPool.current = []
    recSeed.current = null
  }, [])

  const setQueue = useCallback(
    (list, { play = null } = {}) => {
      setQueueState(list)
      queueRef.current = list
      resetContext(list)
      if (play === null) {
        setCurrentIndex(-1)
        idxRef.current = -1
      }
    },
    [resetContext]
  )

  const playFromList = useCallback(
    (list, i) => {
      setQueueState(list)
      queueRef.current = list
      resetContext(list)
      playTrack(i)
    },
    [playTrack, resetContext]
  )

  const resetNowPlaying = useCallback(() => {
    playingRef.current = false
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

  useEffect(() => {
    qRemoveRef.current = qRemove
  }, [qRemove])

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
      resetContext([song])
      settings.setRadio(true)
      setStatus("Radio on — I'll keep similar songs coming.")
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
      resetContext(songs)
      settings.setRadio(true)
      playTrack(0)
    },
    [playTrack, resetContext, settings]
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
      seekFrac, seekBy, seekTo, setVolume, setSleepGain, reloadActive, qMove, qRemove, qClear,
      startRadioFrom, startArtistRadio, resetNowPlaying, resumeFromSystem,
      // Transition truth for the "Mixing" badge, plus typed stop reasons so the
      // UI can offer the right recovery instead of one generic error.
      transition,
      stopReason,
      dismissRecommendation,
      clearForcedQuality,
      analyserRef: analyser, freqDataRef: freqData,
      audioRef: activeRef,
      // Exposed so the UI can explain iOS-specific behaviour without probing
      // the user agent on every render.
      ios: isIOS(),
    }),
    [
      queue, currentIndex, current, isPlaying, clock, volume, currentQuality,
      setQueue, playFromList, playTrack, nextTrack, prevTrack, togglePlay, play, pause,
      seekFrac, seekBy, seekTo, setVolume, setSleepGain, reloadActive, qMove, qRemove, qClear,
      startRadioFrom, startArtistRadio, resetNowPlaying, resumeFromSystem,
      transition, stopReason, dismissRecommendation, clearForcedQuality,
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
