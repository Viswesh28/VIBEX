import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { decodeHtml, fmtNum } from '../lib/format.js'
import { imgOf } from '../lib/song.js'
import { CardGrid } from './CardGrid.jsx'
import { Icon } from './Icon.jsx'
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
  const { dataSaver, isExcluded, excludeArtist, unexcludeArtist } = useSettings()
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
        setStatus('')
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

  if (error) return <EmptyState icon="alert" title="Failed to load artist" hint={error} />
  if (!data) return <Spinner />

  const songs = (data.topSongs || []).filter((s) => s.downloadUrl?.length)
  const albums = data.topAlbums || []
  const followers = fmtNum(data.followerCount)
  const excluded = isExcluded(data.name)

  return (
    <>
      <section className="hero" aria-labelledby="artistTitle">
        <div
          className="hero-wash"
          aria-hidden="true"
          style={{ backgroundImage: `url("${imgOf(data, dataSaver)}")` }}
        />
        <div className="hero-scrim" aria-hidden="true" />
        <img className="hero-cover round" src={imgOf(data, dataSaver)} alt="" />
        <div className="hero-body">
          <span className="eyebrow">
            <span className="dot" aria-hidden="true" />
            Artist
          </span>
          <h3 id="artistTitle">
            {decodeHtml(data.name)}{' '}
            {data.isVerified && (
              <span className="verified" title="Verified artist">
                <Icon name="verified" size={20} />
                <span className="sr-only">Verified artist</span>
              </span>
            )}
          </h3>
          <div className="hero-meta">
            {[data.dominantLanguage, data.type, followers ? `${followers} followers` : '']
              .filter(Boolean)
              .join(' · ')}
          </div>
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
            <button type="button" className="btn-ghost on-art" onClick={() => startArtistRadio(songs)}>
              <Icon name="radio" size={15} />
              Artist radio
            </button>
            <button
              type="button"
              className={'btn-ghost on-art' + (excluded ? ' on' : '')}
              aria-pressed={excluded}
              title={
                excluded
                  ? `Stop excluding ${decodeHtml(data.name)} from suggestions`
                  : `Hide ${decodeHtml(data.name)} from suggestions`
              }
              onClick={() =>
                excluded ? unexcludeArtist(data.name) : excludeArtist(data.name)
              }
            >
              <Icon name={excluded ? 'check' : 'ban'} size={15} />
              {excluded ? 'Excluded' : 'Don’t suggest'}
            </button>
          </div>
        </div>
      </section>

      <SectionTitle>
        Top songs <span>{songs.length}</span>
      </SectionTitle>
      <SongList songs={songs} numbered />

      {albums.length > 0 && (
        <>
          <SectionTitle>
            Albums <span>{albums.length}</span>
          </SectionTitle>
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
