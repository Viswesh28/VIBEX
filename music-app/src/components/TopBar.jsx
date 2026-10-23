import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { decodeHtml } from '../lib/format.js'
import { artistsOf, imgOf } from '../lib/song.js'
import { SettingsPanel } from './SettingsPanel.jsx'
import { SourceBanner, SourceSwitch } from './SourceSwitch.jsx'
import { Icon } from './Icon.jsx'
import { usePlayerTransport } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useUI } from '../state/UIContext.jsx'

const TABS = ['all', 'songs', 'albums', 'playlists', 'artists']
const CHIPS = ['Anirudh hits', 'A.R. Rahman', 'Tamil 90s hits', 'Arijit Singh', 'Ilaiyaraaja', 'Vijay songs']

export function TopBar({ sleep, onMenu }) {
  const { theme, toggleTheme, dsp } = useSettings()
  const { playFromList } = usePlayerTransport()
  const {
    searchQuery,
    setSearchQuery,
    searchTab,
    search,
    recentSearches,
    removeRecentSearch,
    clearRecentSearches,
    setCmdOpen,
    setDspOpen,
    openShareToVibex,
  } = useUI()

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const wrapRef = useRef(null)
  const searchBoxRef = useRef(null)

  useEffect(() => {
    if (!settingsOpen && !suggestOpen) return undefined
    const onDoc = (e) => {
      if (settingsOpen && !wrapRef.current?.contains(e.target)) setSettingsOpen(false)
      if (suggestOpen && !searchBoxRef.current?.contains(e.target)) setSuggestOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setSettingsOpen(false)
        setSuggestOpen(false)
      }
    }
    document.addEventListener('click', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [settingsOpen, suggestOpen])

  // Debounced live autocomplete suggestions while typing in the search bar.
  useEffect(() => {
    const q = searchQuery.trim()
    if (!suggestOpen || q.length < 2) {
      setSuggestions([])
      return undefined
    }
    let alive = true
    const timer = setTimeout(() => {
      api(`/search/songs?query=${encodeURIComponent(q)}&limit=5`)
        .then((d) => {
          if (alive) setSuggestions((d?.results || []).slice(0, 5))
        })
        .catch(() => {
          if (alive) setSuggestions([])
        })
    }, 260)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [searchQuery, suggestOpen])

  const submit = () => {
    setSuggestOpen(false)
    search(searchQuery, searchTab)
  }

  const eqActive = Boolean(
    dsp?.eqOn || dsp?.loudnessNorm || dsp?.slowedReverb || Number(dsp?.reverbMix) > 0
  )

  return (
    <header id="topbar">
      <button id="menuBtn" className="icon-btn" aria-label="Open menu" onClick={onMenu}>
        <Icon name="menu" size={21} />
      </button>

      <div className="search-wrap" ref={searchBoxRef}>
        <Icon name="search" size={17} />
        <input
          id="searchInput"
          type="search"
          enterKeyHint="search"
          aria-label="Search songs, albums, playlists and artists"
          placeholder="Search songs, albums, playlists…"
          value={searchQuery}
          onFocus={() => setSuggestOpen(true)}
          onChange={(e) => {
            setSearchQuery(e.target.value)
            setSuggestOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        {searchQuery.length > 0 && (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear search query"
            title="Clear"
            onClick={() => setSearchQuery('')}
          >
            <Icon name="close" size={14} />
          </button>
        )}
        <button type="button" className="search-submit" onClick={submit}>
          Search
        </button>

        {suggestOpen && (suggestions.length > 0 || recentSearches.length > 0) && (
          <div className="search-dropdown" role="region" aria-label="Search suggestions">
            {suggestions.length > 0 && (
              <div className="sd-group">
                <div className="sd-head">Instant matches</div>
                {suggestions.map((song, idx) => (
                  <button
                    key={song.id || idx}
                    type="button"
                    className="sd-row"
                    onClick={() => {
                      setSuggestOpen(false)
                      playFromList(suggestions, idx)
                    }}
                  >
                    <img src={imgOf(song, true)} alt="" />
                    <span className="sd-meta">
                      <b>{decodeHtml(song.name)}</b>
                      <small>{decodeHtml(artistsOf(song))}</small>
                    </span>
                    <Icon name="play" size={13} />
                  </button>
                ))}
              </div>
            )}

            {recentSearches.length > 0 && (
              <div className="sd-group">
                <div className="sd-head">
                  <span>Recent searches</span>
                  <button
                    type="button"
                    className="sd-clear-all"
                    onClick={() => clearRecentSearches()}
                  >
                    Clear
                  </button>
                </div>
                {recentSearches.slice(0, 6).map((term) => (
                  <div key={term} className="sd-recent-row">
                    <button
                      type="button"
                      className="sd-recent-term"
                      onClick={() => {
                        setSuggestOpen(false)
                        search(term, searchTab)
                      }}
                    >
                      <Icon name="clock" size={13} />
                      <span>{term}</span>
                    </button>
                    <button
                      type="button"
                      className="sd-recent-rm"
                      aria-label={`Remove ${term} from recent searches`}
                      onClick={() => removeRecentSearch(term)}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="tabs" role="tablist" aria-label="Search in">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={searchTab === t}
            className={'tab' + (searchTab === t ? ' active' : '')}
            onClick={() => search(searchQuery, t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <SourceSwitch />

      <div className="top-actions">
        <button
          type="button"
          className="icon-btn"
          title="Share / Open Link in VIBEX (YouTube, YT Music, Spotify, JioSaavn)"
          aria-label="Open shared music link"
          onClick={() => openShareToVibex()}
        >
          <Icon name="link" size={18} />
        </button>
        <button
          type="button"
          className="icon-btn top-cmd-btn"
          title="Command palette (Ctrl+K)"
          aria-label="Open command palette"
          onClick={() => setCmdOpen(true)}
        >
          <Icon name="command" size={18} />
        </button>
        <button
          type="button"
          className={'icon-btn top-eq-btn' + (eqActive ? ' toggled' : '')}
          title="Studio EQ & Audio FX"
          aria-label="Open Studio EQ"
          aria-pressed={eqActive}
          onClick={() => setDspOpen(true)}
        >
          <Icon name="sliders" size={18} />
        </button>
        <button
          className="icon-btn"
          title="Toggle dark / light"
          aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
          onClick={toggleTheme}
        >
          <Icon name={theme === 'light' ? 'moon' : 'sun'} size={19} />
        </button>
        <div id="setWrap" ref={wrapRef}>
          <button
            type="button"
            className={'icon-btn' + (settingsOpen ? ' toggled' : '')}
            title="Playback settings"
            aria-label="Playback settings"
            aria-expanded={settingsOpen}
            onClick={(e) => {
              e.stopPropagation()
              setSettingsOpen((v) => !v)
            }}
          >
            <Icon name="settings" size={19} />
          </button>
          <SettingsPanel open={settingsOpen} sleep={sleep} />
        </div>
      </div>

      <SourceBanner />
    </header>
  )
}

export function Chips() {
  const { search } = useUI()
  return (
    <div className="chips" id="chips">
      {CHIPS.map((c) => (
        <button type="button" className="chip" key={c} onClick={() => search(c, 'songs')}>
          {c}
        </button>
      ))}
    </div>
  )
}
