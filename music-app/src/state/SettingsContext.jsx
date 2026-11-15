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
import { normalizeSource } from '../lib/sources.js'
import { DEFAULT_DSP, EQ_PRESETS, clampEqGains } from '../lib/audioDsp.js'

const Ctx = createContext(null)
export const useSettings = () => useContext(Ctx)

const VIZ_STYLES = ['spectrum', 'bars', 'wave', 'orbit']
const REPEATS = ['off', 'all', 'one']
const SHUFFLE_MODES = ['off', 'on', 'smart']
const SHUFFLE_NEXT = { off: 'on', on: 'smart', smart: 'off' }
const QUALITIES = ['320kbps', '160kbps', '96kbps', '48kbps', '12kbps']

export const AVAILABLE_LANGUAGES = [
  { id: 'tamil', label: 'Tamil' },
  { id: 'hindi', label: 'Hindi' },
  { id: 'english', label: 'English' },
  { id: 'telugu', label: 'Telugu' },
  { id: 'malayalam', label: 'Malayalam' },
  { id: 'kannada', label: 'Kannada' },
  { id: 'punjabi', label: 'Punjabi' },
]

export const DEFAULT_LANGUAGES = ['tamil', 'hindi', 'english', 'telugu', 'malayalam']

const readShuffle = () => {
  const v = store.get('svShuffle', '0')
  if (v === '1') return 'on'
  if (v === 'smart') return 'smart'
  return 'off'
}

const writeShuffle = (mode) => {
  store.set('svShuffle', mode === 'on' ? '1' : mode === 'smart' ? 'smart' : '0')
}

function readLanguages() {
  const saved = store.getJSON('svLangs', null)
  if (!Array.isArray(saved) || !saved.length) return [...DEFAULT_LANGUAGES]
  const validIds = new Set(AVAILABLE_LANGUAGES.map((l) => l.id))
  const filtered = saved.filter((id) => validIds.has(id))
  return filtered.length ? filtered : [...DEFAULT_LANGUAGES]
}

function readDsp() {
  const saved = store.getJSON('svDsp', null)
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_DSP }
  return {
    ...DEFAULT_DSP,
    ...saved,
    eqGains: clampEqGains(saved.eqGains),
  }
}

export function SettingsProvider({ children }) {
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
  const [canvasOn, setCanvasOn] = useState(() => store.get('svCanvas', '1') === '1')
  const [source, setSourceState] = useState(() => normalizeSource(store.get('svSource', 'jiosaavn')))
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
  const [autoplay, setAutoplayState] = useState(() => store.get('svAuto', '1') === '1')
  const [qualityPref, setQualityPrefState] = useState(() => {
    const v = store.get('svQuality', null)
    return QUALITIES.includes(v) ? v : '320kbps'
  })
  const [liveOK, setLiveOK] = useState(() => !ios)
  const [privateSession, setPrivateSessionState] = useState(() => store.get('svPrivate', '0') === '1')
  const [ytApiKey, setYtApiKeyState] = useState(() => store.get('svYtApiKey', '') || '')
  const [excludedArtists, setExcludedArtists] = useState(() => {
    const v = store.getJSON('svExcluded', [])
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []
  })
  const [languages, setLanguagesState] = useState(readLanguages)
  const [dsp, setDspState] = useState(readDsp)
  const [customEqPresets, setCustomEqPresets] = useState(() => {
    const v = store.getJSON('svCustomEq', {})
    return v && typeof v === 'object' ? v : {}
  })

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
      /* ignore */
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
    document.body.classList.toggle('light', theme === 'light')
    setThemeColor(theme === 'light' ? '#f7f7f9' : '#09090b')
    store.set('svTheme', theme)
  }, [theme])

  const updateDsp = useCallback((patch) => {
    setDspState((prev) => {
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch }
      next.eqGains = clampEqGains(next.eqGains)
      store.setJSON('svDsp', next)
      return next
    })
  }, [])

  const setEqPreset = useCallback(
    (presetKey) => {
      const builtin = EQ_PRESETS[presetKey]
      const custom = customEqPresets[presetKey]
      const gains = builtin ? builtin.gains : custom?.gains || EQ_PRESETS.flat.gains
      updateDsp({ eqOn: true, eqPreset: presetKey, eqGains: [...gains] })
    },
    [customEqPresets, updateDsp]
  )

  const setEqBand = useCallback(
    (bandIndex, gainDb) => {
      updateDsp((prev) => {
        const nextGains = [...prev.eqGains]
        nextGains[bandIndex] = gainDb
        return { ...prev, eqOn: true, eqPreset: 'custom', eqGains: nextGains }
      })
    },
    [updateDsp]
  )

  const saveCustomEqPreset = useCallback(
    (name) => {
      const clean = String(name || '').trim().slice(0, 32)
      if (!clean) return null
      const key = 'user_' + clean.toLowerCase().replace(/[^a-z0-9]+/g, '_')
      setCustomEqPresets((prev) => {
        const next = { ...prev, [key]: { label: clean, gains: [...dsp.eqGains] } }
        store.setJSON('svCustomEq', next)
        return next
      })
      updateDsp({ eqPreset: key })
      return key
    },
    [dsp.eqGains, updateDsp]
  )

  const toggleLanguage = useCallback((langId) => {
    setLanguagesState((prev) => {
      const exists = prev.includes(langId)
      const next = exists ? prev.filter((x) => x !== langId) : [...prev, langId]
      const safe = next.length ? next : ['tamil']
      store.setJSON('svLangs', safe)
      return safe
    })
  }, [])

  const setLanguages = useCallback((list) => {
    const validIds = new Set(AVAILABLE_LANGUAGES.map((l) => l.id))
    const clean = (Array.isArray(list) ? list : []).filter((id) => validIds.has(id))
    const safe = clean.length ? clean : [...DEFAULT_LANGUAGES]
    setLanguagesState(safe)
    store.setJSON('svLangs', safe)
  }, [])

  const setDataSaver = useCallback((on) => {
    setDataSaverState(on)
    setSaverAuto(false)
    store.set('svSaver', on ? '1' : '0')
  }, [])

  const cycleShuffle = useCallback(() => {
    setShuffleMode((mode) => {
      const next = SHUFFLE_NEXT[mode] || 'on'
      writeShuffle(next)
      return next
    })
  }, [])

  const chooseShuffleMode = useCallback((mode) => {
    const next = SHUFFLE_MODES.includes(mode) ? mode : 'off'
    setShuffleMode(next)
    writeShuffle(next)
  }, [])

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

  const setYtApiKey = useCallback((raw) => {
    const clean = String(raw || '').trim()
    setYtApiKeyState(clean)
    if (clean) store.set('svYtApiKey', clean)
    else store.remove('svYtApiKey')
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
      source,
      setSource: (id) => {
        const next = normalizeSource(id)
        setSourceState(next)
        store.set('svSource', next)
      },
      ytApiKey,
      setYtApiKey,
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
      setThemeExplicit: (t) => setTheme(t === 'light' ? 'light' : 'dark'),
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
      languages,
      toggleLanguage,
      setLanguages,
      availableLanguages: AVAILABLE_LANGUAGES,
      dsp,
      updateDsp,
      setEqPreset,
      setEqBand,
      customEqPresets,
      saveCustomEqPreset,
    }),
    [
      dataSaver, setDataSaver, saverAuto, crossfadeOn, crossfadeDur, crossfadeLaw, setCrossfadeLaw,
      vizOn, vizStyle, canvasOn, source, ytApiKey, setYtApiKey, shuffleMode, cycleShuffle, chooseShuffleMode,
      repeat, cycleRepeat, theme, radio, setRadio, autoplay, setAutoplay, qualityPref, setQualityPref,
      liveOK, ios, privateSession, excludedArtists, excludeArtist, unexcludeArtist, isExcluded,
      languages, toggleLanguage, setLanguages, dsp, updateDsp, setEqPreset, setEqBand, customEqPresets,
      saveCustomEqPreset,
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
