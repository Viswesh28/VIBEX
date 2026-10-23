import { decodeHtml } from '../lib/format.js'
import { useLibrary } from '../state/LibraryContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useUI } from '../state/UIContext.jsx'
import { Icon, Logo } from './Icon.jsx'

export const NAV = [
  { kind: 'feed', icon: 'home', label: 'Listen Now' },
  { kind: 'search', icon: 'search', label: 'Search' },
  { kind: 'library', icon: 'library', label: 'Library' },
  { kind: 'taste', icon: 'sparkle', label: 'For you' },
  { kind: 'stats', icon: 'stats', label: 'Stats' },
]

export function Sidebar({ apiOnline, open = false, onClose }) {
  const { liked, playlists, account } = useLibrary()
  const { dataSaver } = useSettings()
  const { view, navigate, search, openNewPlaylistModal, setImportModalOpen } = useUI()

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
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            aria-label="Import playlist"
            title="Import Spotify / YouTube / JioSaavn playlist"
          >
            <Icon name="import" size={13} />
            Import
          </button>
          <button type="button" onClick={openNewPlaylistModal} aria-label="Create a playlist">
            <Icon name="plus" size={13} />
            New
          </button>
        </div>
      </div>

      <div id="plNav" className="side-extra" aria-label="Your playlists">
        {playlists.length === 0 ? (
          <div className="nav-hint">No playlists yet. Use + on any song or Import above.</div>
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
        {account && (
          <span className="mode-badge live" title={`Synced as ${account.displayName}`}>
            Cloud synced
          </span>
        )}
        {dataSaver && (
          <span id="saverBadge" style={{ display: 'inline-block' }}>
            Data saver
          </span>
        )}
        <span id="apiUrl" className="side-extra">
          {account ? `Synced: ${account.displayName}` : 'Local-first + optional Cloud Sync'}
        </span>
      </div>

      <div className="side-foot side-extra">
        VIBEX · studio streaming
        <br />
        <span className="kbd-hint">Ctrl+K commands · Space play · N/P skip</span>
      </div>
    </aside>
  )
}
