import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react'
import { store } from '../lib/storage.js'
import { isIOS, setThemeColor } from '../lib/platform.js'
import {
  CROSSFADE_LAWS,
  DEFAULT_CROSSFADE_SEC,
  MAX_CROSSFADE_SEC,
  MIN_CROSSFADE_SEC,
  normaliseLaw,
} from '../lib/transition.js'

const Ctx = createContext(null)
export const useSettings = () => useContext(Ctx)

const VIZ_STYLES = ['spectrum', 'bars', 'wave', 'orbit']
const REPEATS = ['off', 'all', 'one']
// off → on → smart → off. 'smart' keeps the queue in order but slips in one
// recommendation per N tracks; it is not a random walk.
const SHUFFLE_MODES = ['off', 'on', 'smart']
const SHUFFLE_NEXT = { off: 'on', on: 'smart', smart: 'off' }

const readShuffle = () => {
  const v = store.get('svShuffle', '0')
  if (v === '1') return 'on'
  if (v === 'smart') return 'smart'
  return 'off'
}

// 'on' stays "1" so an existing user's stored preference keeps meaning the
// same thing after the upgrade; only the new state needs a new token.
const writeShuffle = (mode) => {
  store.set('svShuffle', mode === 'on' ? '1' : mode === 'smart' ? 'smart' : '0')
}
// The download tiers JioSaavn advertises, highest first.
const QUALITIES = ['320kbps', '160kbps', '96kbps', '48kbps', '12kbps']

/**
 * Every preference is mirrored into localStorage under the same `sv*` keys the
 * pre-React build used, so an existing user's settings survive the upgrade.
 */
export function SettingsProvider({ children }) {
  // iOS routes <audio> through Web Audio as soon as the live analyser is
  // attached, and a suspended AudioContext takes the music with it when the
  // screen locks. Keep the visualiser simulated there so media playback stays
  // a plain <audio> stream — which is what iOS keeps alive in the background.
  const ios = useMemo(() => isIOS(), [])
  const [dataSaver, setDataSaverState] = useState(() => store.get('svSaver', null) === '1')
  const [saverAuto, setSaverAuto] = useState(false)
  const [crossfadeOn, setCrossfadeOn] = useState(() => store.get('svCf', '1') === '1')
  const [crossfadeDur, setCrossfadeDur] = useState(() => {
    const n = Number(store.get('svCfd', String(DEFAULT_CROSSFADE_SEC)))
    if (!Number.isFinite(n)) return DEFAULT_CROSSFADE_SEC
    return Math.min(MAX_CROSSFADE_SEC, Math.max(MIN_CROSSFADE_SEC, n))
  })
  const [crossfadeLaw, setCrossfadeLawState] = useState(() =>
    normaliseLaw(store.get('svCfl', 'equalPower'))
  )
  const [vizOn, setVizOn] = useState(() => store.get('svViz', '1') === '1')
  // Canvas video is a cross-source extra (the clip comes from YouTube Music),
  // so it has its own switch rather than riding on the local visualiser.
  const [canvasOn, setCanvasOn] = useState(() => store.get('svCanvas', '1') === '1')
  const [vizStyle, setVizStyle] = useState(() => {
    const v = store.get('svVizStyle', 'spectrum')
    return VIZ_STYLES.includes(v) ? v : 'spectrum'
  })
  const [shuffleMode, setShuffleMode] = useState(readShuffle)
  const [repeat, setRepeat] = useState(() => {
    const v = store.get('svRepeat', 'all')
    return REPEATS.includes(v) ? v : 'all'
  })
  const [theme, setTheme] = useState(() => (store.get('svTheme', 'dark') === 'light' ? 'light' : 'dark'))
  const [radio, setRadioState] = useState(() => store.get('svRadio', '0') === '1')
  // Autoplay is the tail after the user's own queue: similar songs, clearly
  // marked, never written back into the playlist.
  const [autoplay, setAutoplayState] = useState(() => store.get('svAuto', '1') === '1')
  // Restored like every other preference. JioSaavn's own tier labels, so an
  // unknown stored value falls back to the best quality rather than a blank
  // <select> that matches no <option>.
  const [qualityPref, setQualityPrefState] = useState(() => {
    const v = store.get('svQuality', null)
    return QUALITIES.includes(v) ? v : '320kbps'
  })
  const [liveOK, setLiveOK] = useState(() => !ios)
  // Private session: playback works exactly as always, nothing is written to
  // the listening history that drives the personalised feed.
  const [privateSession, setPrivateSessionState] = useState(() => store.get('svPrivate', '0') === '1')
  const [excludedArtists, setExcludedArtists] = useState(() => {
    const v = store.getJSON('svExcluded', [])
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []
  })

  // On a first-ever visit, respect the browser's own data-saving signals.
  useEffect(() => {
    if (store.get('svSaver', null) !== null) return
    try {
      const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection
      if (c && (c.saveData || /slow-2g|2g/.test(c.effectiveType || ''))) {
        setDataSaverState(true)
        setSaverAuto(true)
        store.set('svSaver', '1')
      }
    } catch {
      /* no Network Information API — leave the default off */
    }
  }, [])

  useEffect(() => {
    // Both roots: tokens hang off body.light, while html.light paints the
    // canvas behind the page (visible when the installed app rubber-bands).
    document.documentElement.classList.toggle('light', theme === 'light')
    document.body.classList.toggle('light', theme === 'light')
    setThemeColor(theme === 'light' ? '#f7f7f9' : '#09090b')
    store.set('svTheme', theme)
  }, [theme])

  const setDataSaver = useCallback((on) => {
    setDataSaverState(on)
    setSaverAuto(false)
    store.set('svSaver', on ? '1' : '0')
  }, [])

  /**
   * Cycles off → on → smart. Reads as `toggleShuffle` for every existing caller,
   * but the third state is what makes Smart Shuffle a real mode rather than a
   * badge on top of random play.
   */
  const cycleShuffle = useCallback(() => {
    setShuffleMode((mode) => {
      const next = SHUFFLE_NEXT[mode] || 'on'
      writeShuffle(next)
      return next
    })
  }, [])

  /** Direct setter for the settings panel's explicit three-way control. */
  const chooseShuffleMode = useCallback((mode) => {
    const next = SHUFFLE_MODES.includes(mode) ? mode : 'off'
    setShuffleMode(next)
    writeShuffle(next)
  }, [])

  // all -> one -> off -> all
  const cycleRepeat = useCallback(() => {
    setRepeat((v) => {
      const next = v === 'all' ? 'one' : v === 'one' ? 'off' : 'all'
      store.set('svRepeat', next)
      return next
    })
  }, [])

  const setRadio = useCallback((on) => {
    setRadioState(on)
    store.set('svRadio', on ? '1' : '0')
  }, [])

  const setAutoplay = useCallback((on) => {
    setAutoplayState(on)
    store.set('svAuto', on ? '1' : '0')
  }, [])

  const setPrivateSession = useCallback((on) => {
    setPrivateSessionState(on)
    store.set('svPrivate', on ? '1' : '0')
  }, [])

  const isExcluded = useCallback(
    (name) => {
      const key = String(name || '').trim().toLowerCase()
      if (!key) return false
      return excludedArtists.some((x) => x.trim().toLowerCase() === key)
    },
    [excludedArtists]
  )

  const excludeArtist = useCallback((name) => {
    const label = String(name || '').trim()
    if (!label) return
    setExcludedArtists((prev) => {
      if (prev.some((x) => x.trim().toLowerCase() === label.toLowerCase())) return prev
      const next = [...prev, label]
      store.setJSON('svExcluded', next)
      return next
    })
  }, [])

  const unexcludeArtist = useCallback((name) => {
    const key = String(name || '').trim().toLowerCase()
    setExcludedArtists((prev) => {
      const next = prev.filter((x) => x.trim().toLowerCase() !== key)
      store.setJSON('svExcluded', next)
      return next
    })
  }, [])

  const setCrossfadeLaw = useCallback((law) => {
    const next = normaliseLaw(law)
    setCrossfadeLawState(next)
    store.set('svCfl', next)
  }, [])

  const setQualityPref = useCallback((q) => {
    setQualityPrefState(q)
    store.set('svQuality', q)
  }, [])

  const value = useMemo(
    () => ({
      dataSaver,
      setDataSaver,
      saverAuto,
      crossfade: { on: crossfadeOn, dur: crossfadeDur, law: crossfadeLaw },
      setCrossfadeOn: (v) => {
        setCrossfadeOn(v)
        store.set('svCf', v ? '1' : '0')
      },
      setCrossfadeDur: (v) => {
        const n = Math.min(MAX_CROSSFADE_SEC, Math.max(MIN_CROSSFADE_SEC, Math.round(+v || 0)))
        setCrossfadeDur(n)
        store.set('svCfd', String(n))
      },
      setCrossfadeLaw,
      crossfadeLaws: CROSSFADE_LAWS,
      viz: { on: vizOn, style: vizStyle },
      setVizOn: (v) => {
        setVizOn(v)
        store.set('svViz', v ? '1' : '0')
      },
      setVizStyle: (v) => {
        setVizStyle(v)
        store.set('svVizStyle', v)
      },
      canvas: canvasOn,
      setCanvas: (v) => {
        setCanvasOn(v)
        store.set('svCanvas', v ? '1' : '0')
      },
      shuffle: shuffleMode !== 'off',
      shuffleMode,
      cycleShuffle,
      setShuffleMode: chooseShuffleMode,
      toggleShuffle: cycleShuffle,
      smartShuffle: shuffleMode === 'smart',
      repeat,
      cycleRepeat,
      theme,
      toggleTheme: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')),
      radio,
      setRadio,
      autoplay,
      setAutoplay,
      qualityPref,
      setQualityPref,
      liveOK,
      setLiveOK,
      ios,
      privateSession,
      setPrivateSession,
      excludedArtists,
      excludeArtist,
      unexcludeArtist,
      isExcluded,
    }),
    [
      dataSaver, setDataSaver, saverAuto, crossfadeOn, crossfadeDur, crossfadeLaw, setCrossfadeLaw,
      vizOn, vizStyle, canvasOn, shuffleMode, cycleShuffle, chooseShuffleMode, repeat, cycleRepeat, theme, radio, setRadio,
      autoplay, setAutoplay, qualityPref, setQualityPref, liveOK, ios, privateSession,
      excludedArtists, excludeArtist, unexcludeArtist, isExcluded,
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
