import { decodeHtml } from '../lib/format.js'
import { useLibrary } from '../state/LibraryContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useUI } from '../state/UIContext.jsx'

const NAV = [
  { kind: 'feed', ico: '⌂', label: 'Home' },
  { kind: 'search', ico: '🔍', label: 'Search' },
  { kind: 'library', ico: '♥', label: 'Library' },
  { kind: 'stats', ico: '📊', label: 'Stats' },
]

export function Sidebar({ apiOnline }) {
  const { liked, playlists } = useLibrary()
  const { dataSaver } = useSettings()
  const { view, navigate, search, openNewPlaylistModal } = useUI()

  // "Search" highlights for artist pages too — they are reached from a search.
  const activeKind = view.kind === 'artist' || view.kind === 'detail' ? 'search' : view.kind

  return (
    <aside id="sidebar">
      <div className="logo">
        <div className="logo-badge">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#04140a">
            <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
          </svg>
        </div>
        <div className="logo-text">
          VIBEX<span className="logo-sub">music player</span>
        </div>
      </div>

      <nav id="sideNav">
        {NAV.map((n) => (
          <div
            key={n.kind}
            className={'nav-item' + (activeKind === n.kind ? ' active' : '')}
            onClick={() => (n.kind === 'search' ? search(null, null) : navigate({ kind: n.kind }))}
          >
            <span className="nav-ico">{n.ico}</span>
            <span className="nav-label">{n.label}</span>
            {n.kind === 'library' && liked.length > 0 && <span id="libCount">{liked.length}</span>}
          </div>
        ))}
      </nav>

      <div className="pl-sec-title side-extra">
        <span>PLAYLISTS</span>
        <button className="ghost" onClick={openNewPlaylistModal}>
          ＋ New
        </button>
      </div>
      <div id="plNav" className="side-extra">
        {playlists.length === 0 ? (
          <div className="nav-hint">None yet — hover a song, tap ＋.</div>
        ) : (
          playlists.map((p) => (
            <div
              key={p.id}
              className={'nav-item' + (view.kind === 'myplaylist' && view.id === p.id ? ' active' : '')}
              title={p.name}
              onClick={() => navigate({ kind: 'myplaylist', id: p.id })}
            >
              <span className="nav-ico">🎵</span>
              <span className="nav-label">{decodeHtml(p.name)}</span>
              <span className="cnt">{p.songs.length}</span>
            </div>
          ))
        )}
      </div>

      <div className="side-div side-extra" />
      <div className="api-box">
        <span className={'mode-badge' + (apiOnline ? ' live' : '')}>
          {apiOnline === null ? 'connecting…' : apiOnline ? 'LOCAL API (same origin)' : 'API OFFLINE'}
        </span>
        {dataSaver && <span id="saverBadge" style={{ display: 'inline-block' }}>💾 DATA SAVER</span>}
        <span id="apiUrl" className="side-extra">
          {apiOnline ? 'Same-origin /api → jiosaavn-api' : ''}
        </span>
      </div>
      <div className="side-foot side-extra">
        VIBEX • Desktop
        <br />
        Space ⏯ · N/P next/prev · ←/→ seek 10s
      </div>
    </aside>
  )
}
