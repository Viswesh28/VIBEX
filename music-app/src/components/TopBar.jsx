import { useEffect, useRef, useState } from 'react'
import { SettingsPanel } from './SettingsPanel.jsx'
import { SourceBanner, SourceSwitch } from './SourceSwitch.jsx'
import { Icon } from './Icon.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useUI } from '../state/UIContext.jsx'

const TABS = ['songs', 'albums', 'playlists', 'artists']
const CHIPS = ['Anirudh hits', 'A.R. Rahman', 'Tamil 90s hits', 'Arijit Singh', 'Ilaiyaraaja', 'Vijay songs']

export function TopBar({ sleep, onMenu }) {
  const { theme, toggleTheme } = useSettings()
  const { searchQuery, setSearchQuery, searchTab, search } = useUI()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!settingsOpen) return undefined
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) setSettingsOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setSettingsOpen(false)
    }
    document.addEventListener('click', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [settingsOpen])

  const submit = () => search(searchQuery, searchTab)

  return (
    <header id="topbar">
      <button id="menuBtn" className="icon-btn" aria-label="Open menu" onClick={onMenu}>
        <Icon name="menu" size={21} />
      </button>

      <div className="search-wrap">
        <Icon name="search" size={17} />
        <input
          id="searchInput"
          type="search"
          enterKeyHint="search"
          aria-label="Search songs, albums, playlists and artists"
          placeholder="Search songs, albums, playlists…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button type="button" className="search-submit" onClick={submit}>
          Search
        </button>
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
