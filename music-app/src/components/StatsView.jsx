import { useEffect, useMemo } from 'react'
import { api } from '../lib/api.js'
import { decodeHtml, fmt } from '../lib/format.js'
import { Icon } from './Icon.jsx'
import { EmptyState, SectionTitle } from './Spinner.jsx'
import { useLibrary } from '../state/LibraryContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useUI } from '../state/UIContext.jsx'

export function StatsView({ onTitle }) {
  const { loadStats, flushStats } = useLibrary()
  const { setStatus } = useStatus()
  const { playFromList } = usePlayer()
  const { search } = useUI()

  // Credit the in-flight track first, so the numbers are current on arrival.
  const stats = useMemo(() => {
    flushStats()
    return loadStats()
  }, [flushStats, loadStats])

  const topSongs = Object.entries(stats.songs).sort((a, b) => b[1].n - a[1].n).slice(0, 10)
  const topArtists = Object.entries(stats.artists).sort((a, b) => b[1].n - a[1].n).slice(0, 10)
  const minutes = Math.round(stats.seconds / 60)

  useEffect(() => {
    onTitle?.('Your Stats', '')
    setStatus('')
  }, [onTitle, setStatus])

  const playById = async (id, name) => {
    setStatus('Loading…')
    try {
      const d = await api(`/songs/${id}`)
      const s = Array.isArray(d) ? d[0] : d.songs?.[0] || d.song || d
      if (s?.downloadUrl?.length) {
        playFromList([s], 0)
        return
      }
      throw new Error('no stream')
    } catch {
      search(name || '', 'songs')
      setStatus("Couldn't replay directly — showing search instead.")
    }
  }

  return (
    <div className="stats">
      <header className="view-head">
        <span className="eyebrow">
          <span className="dot" aria-hidden="true" />
          Listening history
        </span>
        <h2 className="view-title">Your listening</h2>
        <p className="view-sub">Everything below is counted on this device — no accounts, no tracking.</p>
      </header>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-ico" aria-hidden="true">
            <Icon name="play" size={15} />
          </span>
          <b>{stats.plays}</b>
          <span>Songs played</span>
        </div>
        <div className="stat-card">
          <span className="stat-ico" aria-hidden="true">
            <Icon name="clock" size={15} />
          </span>
          <b>{minutes}</b>
          <span>Minutes listened</span>
        </div>
        <div className="stat-card">
          <span className="stat-ico" aria-hidden="true">
            <Icon name="music" size={15} />
          </span>
          <b>{Object.keys(stats.songs).length}</b>
          <span>Unique songs</span>
        </div>
        <div className="stat-card">
          <span className="stat-ico" aria-hidden="true">
            <Icon name="sparkle" size={15} />
          </span>
          <b className="stat-name">{topArtists.length ? topArtists[0][0] : '—'}</b>
          <span>Top artist</span>
        </div>
      </div>

      {topSongs.length > 0 && (
        <SectionTitle>
          Top songs <span>{topSongs.length}</span>
        </SectionTitle>
      )}
      {topSongs.map(([id, e], i) => (
        <div className="stat-row" key={id} onClick={() => playById(id, e.name)}>
          <span className="rank">{i + 1}</span>
          <img
            src={e.img || ''}
            alt=""
            onError={(ev) => {
              ev.currentTarget.style.opacity = 0.25
            }}
          />
          <div className="s-info">
            <div className="s-title">{decodeHtml(e.name)}</div>
            <div className="s-artist">{decodeHtml(e.artist)}</div>
          </div>
          <div className="n">
            {e.n} plays · {fmt(e.sec)}
          </div>
        </div>
      ))}

      {topArtists.length > 0 && (
        <SectionTitle>
          Top artists <span>{topArtists.length}</span>
        </SectionTitle>
      )}
      {topArtists.map(([name, e], i) => (
        <div className="stat-row artist-stat" key={name} onClick={() => search(name, 'artists')}>
          <span className="rank">{i + 1}</span>
          <span className="artist-badge" aria-hidden="true">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <div className="s-info">
            <div className="s-title">{name}</div>
          </div>
          <div className="n">
            {e.n} plays · {fmt(e.sec)}
          </div>
        </div>
      ))}

      {!topSongs.length && (
        <EmptyState
          icon="stats"
          title="No stats yet"
          hint="Play some music and your listening history will appear here."
        />
      )}
    </div>
  )
}
