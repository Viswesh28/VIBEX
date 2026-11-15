import { useEffect, useMemo, useRef, useState } from 'react'
import { decodeHtml } from '../lib/format.js'
import { shareVibexLink } from '../lib/shareUrl.js'
import { Icon } from './Icon.jsx'
import { useLibrary } from '../state/LibraryContext.jsx'
import { usePlayerTransport } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'

export function CommandPalette() {
  const {
    cmdOpen,
    setCmdOpen,
    navigate,
    search,
    setDspOpen,
    setImportModalOpen,
    openShareToVibex,
  } = useUI()
  const { togglePlay, nextTrack, prevTrack, current, togglePip, pipSupported } = usePlayerTransport()
  const { theme, toggleTheme, dsp, updateDsp } = useSettings()
  const { playlists } = useLibrary()
  const { setStatus } = useStatus()

  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    if (cmdOpen) {
      setQuery('')
      setSelectedIdx(0)
      setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [cmdOpen])

  const commands = useMemo(() => {
    const base = [
      ...(query.trim()
        ? [
            {
              id: 'search-now',
              icon: 'search',
              label: `Search “${query.trim()}”`,
              hint: 'Songs & artists',
              run: () => search(query.trim(), 'songs'),
            },
          ]
        : []),
      {
        id: 'go-home',
        icon: 'home',
        label: 'Go to Listen Now',
        hint: 'Home feed',
        run: () => navigate({ kind: 'feed' }),
      },
      {
        id: 'go-lib',
        icon: 'library',
        label: 'Open Your Library',
        hint: 'Liked & offline songs',
        run: () => navigate({ kind: 'library' }),
      },
      {
        id: 'go-taste',
        icon: 'sparkle',
        label: 'Open For You Mix',
        hint: 'Personalized taste station',
        run: () => navigate({ kind: 'taste' }),
      },
      {
        id: 'go-stats',
        icon: 'stats',
        label: 'Open Listening Stats',
        hint: 'Top songs & artists',
        run: () => navigate({ kind: 'stats' }),
      },
      {
        id: 'open-eq',
        icon: 'sliders',
        label: 'Open Studio 10-Band EQ & Audio FX',
        hint: dsp.slowedReverb ? 'Slowed + Reverb active' : dsp.eqPreset,
        run: () => setDspOpen(true),
      },
      {
        id: 'toggle-slowed',
        icon: 'sparkle',
        label: dsp.slowedReverb ? 'Disable Slowed + Reverb' : 'Enable Slowed + Reverb',
        hint: '0.84x tape speed + lush hall reverb',
        run: () => updateDsp({ slowedReverb: !dsp.slowedReverb }),
      },
      {
        id: 'open-share-link',
        icon: 'link',
        label: 'Share to VIBEX — Open Song or Playlist Link',
        hint: 'YouTube · YT Music · Spotify · JioSaavn',
        run: () => openShareToVibex(),
      },
      {
        id: 'open-import',
        icon: 'import',
        label: 'Import Spotify / YouTube / JioSaavn Playlist',
        hint: 'Universal importer',
        run: () => setImportModalOpen(true),
      },
      {
        id: 'toggle-theme',
        icon: theme === 'light' ? 'moon' : 'sun',
        label: theme === 'light' ? 'Switch to Dark Theme' : 'Switch to Light Theme',
        hint: 'Appearance',
        run: () => toggleTheme(),
      },
      {
        id: 'play-pause',
        icon: 'play',
        label: 'Play / Pause Current Track',
        hint: 'Space',
        run: () => togglePlay(),
      },
      {
        id: 'next-track',
        icon: 'next',
        label: 'Skip to Next Track',
        hint: 'N',
        run: () => nextTrack(),
      },
      {
        id: 'prev-track',
        icon: 'prev',
        label: 'Previous Track',
        hint: 'P',
        run: () => prevTrack(),
      },
    ]

    if (pipSupported) {
      base.push({
        id: 'toggle-pip',
        icon: 'pip',
        label: 'Toggle Floating Mini Player (Picture-in-Picture)',
        hint: 'Always-on-top window',
        run: () => togglePip(),
      })
    }

    if (current) {
      base.push({
        id: 'share-current',
        icon: 'share',
        label: `Share “${decodeHtml(current.name)}”`,
        hint: 'Copy deep link',
        run: async () => {
          const r = await shareVibexLink({
            title: decodeHtml(current.name),
            pathOrUrl: `/?play=${encodeURIComponent(current.id)}`,
          })
          if (r.copied) setStatus('Copied deep link to clipboard.')
        },
      })
    }

    for (const p of playlists) {
      base.push({
        id: `pl-${p.id}`,
        icon: 'music',
        label: `Playlist: ${decodeHtml(p.name)}`,
        hint: `${p.songs.length} songs`,
        run: () => navigate({ kind: 'myplaylist', id: p.id }),
      })
    }

    const needle = query.trim().toLowerCase()
    if (!needle) return base
    return base.filter(
      (item) =>
        item.id === 'search-now' ||
        item.label.toLowerCase().includes(needle) ||
        item.hint.toLowerCase().includes(needle)
    )
  }, [
    current, dsp.eqPreset, dsp.slowedReverb, navigate, nextTrack, pipSupported,
    playlists, prevTrack, query, search, setDspOpen, setImportModalOpen,
    setStatus, theme, togglePip, togglePlay, toggleTheme, updateDsp,
  ])

  if (!cmdOpen) return null

  const execute = (item) => {
    if (!item) return
    setCmdOpen(false)
    item.run()
  }

  return (
    <div id="plModal" className="open" onClick={() => setCmdOpen(false)}>
      <div
        className="modal-card cmd-palette-card"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmd-search-bar">
          <Icon name="command" size={17} />
          <input
            ref={inputRef}
            type="text"
            aria-label="Type a command or search query"
            placeholder="Search songs, jump to playlists, toggle Studio EQ…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIdx(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelectedIdx((i) => Math.min(commands.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelectedIdx((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                execute(commands[selectedIdx])
              }
            }}
          />
          <button
            type="button"
            className="icon-btn"
            aria-label="Close command palette"
            onClick={() => setCmdOpen(false)}
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="cmd-list" role="listbox" aria-label="Commands">
          {commands.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={idx === selectedIdx}
              className={'cmd-row' + (idx === selectedIdx ? ' active' : '')}
              onClick={() => execute(item)}
            >
              <Icon name={item.icon} size={16} />
              <span className="cmd-label">{item.label}</span>
              <span className="cmd-hint">{item.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
