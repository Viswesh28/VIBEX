import { decodeHtml } from '../lib/format.js'
import { useLibrary } from '../state/LibraryContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useUI } from '../state/UIContext.jsx'
import { Icon, Logo } from './Icon.jsx'

/**
 * Primary destinations. The `icon` name maps into Icon.jsx; keeping the list
 * here means the desktop rail and the phone tab bar can never drift apart.
 */
export const NAV = [
  { kind: 'feed', icon: 'home', label: 'Listen Now' },
  { kind: 'search', icon: 'search', label: 'Search' },
  { kind: 'library', icon: 'library', label: 'Library' },
  { kind: 'stats', icon: 'stats', label: 'Stats' },
]

export function Sidebar({ apiOnline, open = false, onClose }) {
  const { liked, playlists } = useLibrary()
  const { dataSaver } = useSettings()
  const { view, navigate, search, openNewPlaylistModal } = useUI()

  // Artist and detail pages are reached from a search, so Search stays lit.
  const activeKind = view.kind === 'artist' || view.kind === 'detail' ? 'search' : view.kind

  const go = (kind) => {
    onClose?.()
    if (kind === 'search') search(null, null)
    else navigate({ kind })
  }

  return (
    <aside id="sidebar" className={open ? 'open' : ''} aria-label="Browse">
      <div className="brand">
        <Logo size={36} />
        <div className="brand-text">
          <span className="brand-name">VIBEX</span>
          <span className="brand-sub">Music player</span>
        </div>
      </div>

      <nav id="sideNav" aria-label="Sections">
        {NAV.map((n) => (
          <button
            key={n.kind}
            type="button"
            className={'nav-item' + (activeKind === n.kind ? ' active' : '')}
            aria-current={activeKind === n.kind ? 'page' : undefined}
            onClick={() => go(n.kind)}
          >
            <Icon name={n.icon} size={19} />
            <span className="nav-label">{n.label}</span>
            {n.kind === 'library' && liked.length > 0 && <span id="libCount">{liked.length}</span>}
          </button>
        ))}
      </nav>

      <div className="side-div" />

      <div className="side-label side-extra">
        <span>Playlists</span>
        <button type="button" onClick={openNewPlaylistModal} aria-label="Create a playlist">
          <Icon name="plus" size={13} />
          New
        </button>
      </div>

      <div id="plNav" className="side-extra" aria-label="Your playlists">
        {playlists.length === 0 ? (
          <div className="nav-hint">No playlists yet. Use + on any song to start one.</div>
        ) : (
          playlists.map((p) => (
            <button
              key={p.id}
              type="button"
              className={
                'nav-item' + (view.kind === 'myplaylist' && view.id === p.id ? ' active' : '')
              }
              title={decodeHtml(p.name)}
              onClick={() => {
                onClose?.()
                navigate({ kind: 'myplaylist', id: p.id })
              }}
            >
              <Icon name="music" size={17} />
              <span className="nav-label">{decodeHtml(p.name)}</span>
              <span className="cnt">{p.songs.length}</span>
            </button>
          ))
        )}
      </div>

      <div className="api-box">
        <span className={'mode-badge' + (apiOnline ? ' live' : '')}>
          {apiOnline === null ? 'Connecting' : apiOnline ? 'Live catalogue' : 'Offline'}
        </span>
        {dataSaver && (
          <span id="saverBadge" style={{ display: 'inline-block' }}>
            Data saver
          </span>
        )}
        <span id="apiUrl" className="side-extra">
          Same-origin /api — no keys, no tracking.
        </span>
      </div>

      <div className="side-foot side-extra">
        VIBEX · personal listening
        <br />
        <span className="kbd-hint">Space play · N/P skip · ←/→ seek 10s</span>
      </div>
    </aside>
  )
}
