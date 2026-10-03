import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { decodeHtml, fmtNum } from '../lib/format.js'
import { imgOf } from '../lib/song.js'
import { CardGrid } from './CardGrid.jsx'
import { SongList } from './SongList.jsx'
import { EmptyState, SectionTitle, Spinner } from './Spinner.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useUI } from '../state/UIContext.jsx'

export function ArtistView({ id, onTitle }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const { setStatus } = useStatus()
  const { playFromList, startArtistRadio } = usePlayer()
  const { dataSaver } = useSettings()
  const { navigate } = useUI()

  useEffect(() => {
    let alive = true
    setData(null)
    setError(null)
    setStatus('Loading artist…')
    api(`/artists/${id}?songCount=15&albumCount=12`)
      .then((d) => {
        if (!alive) return
        setData(d)
        onTitle?.(
          decodeHtml(d.name || 'Artist'),
          d.followerCount ? `(${fmtNum(d.followerCount)} followers)` : ''
        )
        setStatus('Click a song to play.')
      })
      .catch((e) => {
        if (!alive) return
        setError(e.message)
        setStatus('Failed to load artist: ' + e.message, true)
      })
    return () => {
      alive = false
    }
  }, [id, setStatus, onTitle])

  if (error) return <EmptyState icon="⚠️" title="Failed to load artist" hint={error} />
  if (!data) return <Spinner />

  const songs = (data.topSongs || []).filter((s) => s.downloadUrl?.length)
  const albums = data.topAlbums || []

  return (
    <>
      <div className="artist-head">
        <img
          src={imgOf(data, dataSaver)}
          alt=""
          onError={(e) => {
            e.currentTarget.style.opacity = 0.25
          }}
        />
        <div>
          <h3>
            {decodeHtml(data.name)} {data.isVerified && <span className="verified">✔</span>}
          </h3>
          <p>{[data.type, data.dominantLanguage].filter(Boolean).join(' • ')}</p>
          <button onClick={() => songs.length && playFromList(songs, 0)}>▶ Play top songs</button>
          <button className="ghost" onClick={() => startArtistRadio(songs)}>
            📻 Artist radio
          </button>
        </div>
      </div>
      <SectionTitle>Top songs ({songs.length})</SectionTitle>
      <SongList songs={songs} numbered />
      {albums.length > 0 && (
        <>
          <SectionTitle>Albums ({albums.length})</SectionTitle>
          <CardGrid
            items={albums}
            kind="album"
            onOpen={(a) => navigate({ kind: 'detail', type: 'album', id: a.id })}
          />
        </>
      )}
    </>
  )
}
