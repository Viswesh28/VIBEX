import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { decodeHtml } from '../lib/format.js'
import { imgOf } from '../lib/song.js'
import { Icon } from './Icon.jsx'
import { SongList } from './SongList.jsx'
import { EmptyState, Spinner } from './Spinner.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { usePlayerTransport } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'

/** An album or a JioSaavn playlist: an editorial hero plus its tracks. */
export function DetailView({ type, id, onTitle }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const { setStatus } = useStatus()
  const { playFromList } = usePlayerTransport()
  const s = useSettings()

  useEffect(() => {
    let alive = true
    setData(null)
    setError(null)
    setStatus('Loading ' + type + '…')
    api(type === 'album' ? `/albums?id=${id}` : `/playlists?id=${id}&limit=100`)
      .then((d) => {
        if (!alive) return
        setData(d)
        const songs = d.songs || []
        onTitle?.(decodeHtml(d.name || type), `(${songs.length} songs)`)
        setStatus('')
      })
      .catch((e) => {
        if (!alive) return
        setError(e.message)
        setStatus('Failed to load ' + type + ': ' + e.message, true)
      })
    return () => {
      alive = false
    }
  }, [type, id, setStatus, onTitle])

  if (error) return <EmptyState icon="alert" title={`Failed to load ${type}`} hint={error} />
  if (!data) return <Spinner />

  const songs = data.songs || []
  const meta = [
    type === 'album' ? 'Album' : 'Playlist',
    data.year,
    songs.length ? `${songs.length} songs` : '',
    data.language,
  ].filter(Boolean)

  const shufflePlay = () => {
    if (!songs.length) return
    if (!s.shuffle) s.toggleShuffle()
    playFromList(songs, Math.floor(Math.random() * songs.length))
  }

  return (
    <>
      <section className="hero" aria-labelledby="detailTitle">
        <div
          className="hero-wash"
          aria-hidden="true"
          style={{ backgroundImage: `url("${imgOf(data, s.dataSaver)}")` }}
        />
        <div className="hero-scrim" aria-hidden="true" />
        <img
          className="hero-cover"
          src={imgOf(data, s.dataSaver)}
          fetchpriority="high"
          decoding="async"
          alt=""
        />
        <div className="hero-body">
          <span className="eyebrow">
            <span className="dot" aria-hidden="true" />
            {type === 'album' ? 'Album' : 'Playlist'}
          </span>
          <h3 id="detailTitle">{decodeHtml(data.name)}</h3>
          <div className="hero-meta">
            {meta.slice(1).map((part, i) => (
              <span key={part + i}>
                {i > 0 && <span className="sep"> · </span>}
                {part}
              </span>
            ))}
          </div>
          {data.description && <p className="hero-desc">{decodeHtml(data.description)}</p>}
          <div className="hero-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => songs.length && playFromList(songs, 0)}
              disabled={!songs.length}
            >
              <Icon name="play" size={15} />
              Play
            </button>
            <button
              type="button"
              className={'btn-ghost on-art' + (s.shuffle ? ' on' : '')}
              onClick={shufflePlay}
              aria-pressed={s.shuffle}
            >
              <Icon name="shuffle" size={15} />
              Shuffle
            </button>
          </div>
        </div>
      </section>

      <SongList songs={songs} numbered />
    </>
  )
}
