import { useEffect, useMemo } from 'react'
import { api } from '../lib/api.js'
import { decodeHtml, fmt } from '../lib/format.js'
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

  useEffect(() => {
    onTitle?.('Your Stats', '')
    setStatus(
      topSongs.length
        ? 'Your listening stats — click a song to play it.'
        : 'Play something to start building stats.'
    )
  }, [onTitle, setStatus, topSongs.length])

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
    <>
      <div className="stat-grid">
        <div className="stat-card">
          <b>{stats.plays}</b>
          <span>▶ songs played</span>
        </div>
        <div className="stat-card">
          <b>{Math.round(stats.seconds / 60)}</b>
          <span>⏱ minutes listened</span>
        </div>
        <div className="stat-card">
          <b>{Object.keys(stats.songs).length}</b>
          <span>🎵 unique songs</span>
        </div>
        <div className="stat-card">
          <b style={{ fontSize: 15 }}>{topArtists.length ? topArtists[0][0] : '—'}</b>
          <span>👑 top artist</span>
        </div>
      </div>

      {topSongs.length > 0 && <SectionTitle>Top songs</SectionTitle>}
      {topSongs.map(([id, e]) => (
        <div className="stat-row" key={id} onClick={() => playById(id, e.name)}>
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
            {e.n} plays • {fmt(e.sec)} listened
          </div>
        </div>
      ))}

      {topArtists.length > 0 && <SectionTitle>Top artists</SectionTitle>}
      {topArtists.map(([name, e]) => (
        <div className="stat-row" key={name} onClick={() => search(name, 'artists')}>
          <div className="s-info">
            <div className="s-title">{name}</div>
          </div>
          <div className="n">
            {e.n} plays • {fmt(e.sec)} listened
          </div>
        </div>
      ))}

      {!topSongs.length && (
        <EmptyState
          icon="📊"
          title="No stats yet"
          hint="Play some music and your listening stats will appear here."
        />
      )}
    </>
  )
}
