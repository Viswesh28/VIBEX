import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react'
import { store } from '../lib/storage.js'
import { isIOS, setThemeColor } from '../lib/platform.js'

const Ctx = createContext(null)
export const useSettings = () => useContext(Ctx)

const VIZ_STYLES = ['spectrum', 'bars', 'wave', 'orbit']
const REPEATS = ['off', 'all', 'one']
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
  const [crossfadeDur, setCrossfadeDur] = useState(() =>
    Math.min(12, Math.max(1, +(store.get('svCfd', '5') || 5)))
  )
  const [vizOn, setVizOn] = useState(() => store.get('svViz', '1') === '1')
  const [vizStyle, setVizStyle] = useState(() => {
    const v = store.get('svVizStyle', 'spectrum')
    return VIZ_STYLES.includes(v) ? v : 'spectrum'
  })
  const [shuffle, setShuffle] = useState(() => store.get('svShuffle', '0') === '1')
  const [repeat, setRepeat] = useState(() => {
    const v = store.get('svRepeat', 'all')
    return REPEATS.includes(v) ? v : 'all'
  })
  const [theme, setTheme] = useState(() => (store.get('svTheme', 'dark') === 'light' ? 'light' : 'dark'))
  const [radio, setRadioState] = useState(() => store.get('svRadio', '0') === '1')
  // Restored like every other preference. JioSaavn's own tier labels, so an
  // unknown stored value falls back to the best quality rather than a blank
  // <select> that matches no <option>.
  const [qualityPref, setQualityPrefState] = useState(() => {
    const v = store.get('svQuality', null)
    return QUALITIES.includes(v) ? v : '320kbps'
  })
  const [liveOK, setLiveOK] = useState(() => !ios)

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

  const toggleShuffle = useCallback(() => {
    setShuffle((v) => {
      store.set('svShuffle', !v ? '1' : '0')
      return !v
    })
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

  const setQualityPref = useCallback((q) => {
    setQualityPrefState(q)
    store.set('svQuality', q)
  }, [])

  const value = useMemo(
    () => ({
      dataSaver,
      setDataSaver,
      saverAuto,
      crossfade: { on: crossfadeOn, dur: crossfadeDur },
      setCrossfadeOn: (v) => {
        setCrossfadeOn(v)
        store.set('svCf', v ? '1' : '0')
      },
      setCrossfadeDur: (v) => {
        setCrossfadeDur(v)
        store.set('svCfd', String(v))
      },
      viz: { on: vizOn, style: vizStyle },
      setVizOn: (v) => {
        setVizOn(v)
        store.set('svViz', v ? '1' : '0')
      },
      setVizStyle: (v) => {
        setVizStyle(v)
        store.set('svVizStyle', v)
      },
      shuffle,
      toggleShuffle,
      repeat,
      cycleRepeat,
      theme,
      toggleTheme: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')),
      radio,
      setRadio,
      qualityPref,
      setQualityPref,
      liveOK,
      setLiveOK,
      ios,
    }),
    [
      dataSaver, setDataSaver, saverAuto, crossfadeOn, crossfadeDur, vizOn, vizStyle,
      shuffle, toggleShuffle, repeat, cycleRepeat, theme, radio, setRadio, qualityPref, setQualityPref,
      liveOK, ios,
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
