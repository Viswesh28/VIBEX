import { useEffect, useRef, useState } from 'react'
import { SettingsPanel } from './SettingsPanel.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useUI } from '../state/UIContext.jsx'

const TABS = ['songs', 'albums', 'playlists', 'artists']
const CHIPS = ['Anirudh hits', 'A.R. Rahman', 'Tamil 90s hits', 'Arijit Singh', 'Ilaiyaraaja', 'Vijay songs']

export function TopBar({ sleep }) {
  const { theme, toggleTheme } = useSettings()
  const { searchQuery, setSearchQuery, searchTab, search } = useUI()
  const [setOpen, setSetOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!setOpen) return undefined
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) setSetOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [setOpen])

  return (
    <header id="topbar">
      <div className="search-wrap">
        <input
          id="searchInput"
          type="text"
          placeholder="Search songs, albums, playlists..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search(e.currentTarget.value, searchTab)}
        />
        <button onClick={() => search(searchQuery, searchTab)}>Search</button>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <div
            key={t}
            className={'tab' + (searchTab === t ? ' active' : '')}
            onClick={() => search(searchQuery, t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </div>
        ))}
      </div>
      <button className="ghost" title="Toggle dark / light" onClick={toggleTheme}>
        {theme === 'light' ? '☀️' : '🌙'}
      </button>
      <div id="setWrap" ref={wrapRef}>
        <button
          className="ghost"
          title="Playback settings"
          onClick={(e) => {
            e.stopPropagation()
            setSetOpen((v) => !v)
          }}
        >
          ⚙️
        </button>
        <SettingsPanel open={setOpen} sleep={sleep} />
      </div>
    </header>
  )
}

export function Chips() {
  const { search } = useUI()
  return (
    <div className="chips" id="chips">
      {CHIPS.map((c) => (
        <div className="chip" key={c} onClick={() => search(c, 'songs')}>
          {c}
        </div>
      ))}
    </div>
  )
}
