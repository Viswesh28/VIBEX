import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { decodeHtml } from '../lib/format.js'
import { imgOf } from '../lib/song.js'
import { SongList } from './SongList.jsx'
import { EmptyState, Spinner } from './Spinner.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'

/** An album or a JioSaavn playlist: header plus its tracks. */
export function DetailView({ type, id, onTitle }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const { setStatus } = useStatus()
  const { playFromList } = usePlayer()
  const { dataSaver } = useSettings()

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
        setStatus(songs.length ? 'Click a song to play.' : 'No songs in this ' + type + '.')
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

  if (error) return <EmptyState icon="⚠️" title={`Failed to load ${type}`} hint={error} />
  if (!data) return <Spinner />

  const songs = data.songs || []
  return (
    <>
      <div className="detail-head">
        <img
          src={imgOf(data, dataSaver)}
          alt=""
          onError={(e) => {
            e.currentTarget.style.opacity = 0.25
          }}
        />
        <div>
          <h3>{decodeHtml(data.name)}</h3>
          <p>
            {decodeHtml(data.description || '')}
            {data.year ? ` • ${data.year}` : ''}
          </p>
          <button onClick={() => songs.length && playFromList(songs, 0)}>▶ Play all</button>
        </div>
      </div>
      <SongList songs={songs} numbered />
    </>
  )
}
