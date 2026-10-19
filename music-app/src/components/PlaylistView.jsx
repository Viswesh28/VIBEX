import { useEffect, useState } from 'react'
import { decodeHtml } from '../lib/format.js'
import { imgOf } from '../lib/song.js'
import { Icon } from './Icon.jsx'
import { SongList } from './SongList.jsx'
import { EmptyState } from './Spinner.jsx'
import { useLibrary } from '../state/LibraryContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useUI } from '../state/UIContext.jsx'

/** A playlist the user built, stored on this device. */
export function PlaylistView({ id, onTitle }) {
  const { playlists, deletePlaylist, removeFromPlaylist } = useLibrary()
  const { setStatus } = useStatus()
  const { playFromList } = usePlayer()
  const { dataSaver } = useSettings()
  const { navigate, openRenameModal } = useUI()
  const [armed, setArmed] = useState(false)

  const pl = playlists.find((p) => p.id === id)

  useEffect(() => {
    if (!pl) return
    onTitle?.(decodeHtml(pl.name), `${pl.songs.length} songs`)
    setStatus('')
  }, [pl, onTitle, setStatus])

  // Give the "are you sure" state a moment, then disarm.
  useEffect(() => {
    if (!armed) return undefined
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])

  if (!pl) return <EmptyState icon="music" title="Playlist not found" />

  const play = () => pl.songs.length && playFromList(pl.songs, 0)
  const cover = pl.songs.length ? imgOf(pl.songs[0], dataSaver) : ''

  return (
    <>
      <section className="hero" aria-labelledby="playlistTitle">
        {cover ? (
          <div className="hero-wash" aria-hidden="true" style={{ backgroundImage: `url("${cover}")` }} />
        ) : null}
        <div className="hero-scrim" aria-hidden="true" />
        {cover ? (
          <img className="hero-cover" src={cover} alt="" />
        ) : (
          <div className="hero-cover hero-placeholder" aria-hidden="true">
            <Icon name="music" size={54} />
          </div>
        )}
        <div className="hero-body">
          <span className="eyebrow">
            <span className="dot" aria-hidden="true" />
            Your playlist
          </span>
          <h3 id="playlistTitle">{decodeHtml(pl.name)}</h3>
          <div className="hero-meta">
            {pl.songs.length} {pl.songs.length === 1 ? 'song' : 'songs'} · saved on this device
          </div>
          <div className="hero-actions">
            <button type="button" className="btn-primary" onClick={play} disabled={!pl.songs.length}>
              <Icon name="play" size={15} />
              Play
            </button>
            <button
              type="button"
              className="btn-ghost on-art"
              onClick={() => openRenameModal(pl.id, pl.name)}
            >
              <Icon name="pencil" size={15} />
              Rename
            </button>
            <button
              type="button"
              className={'btn-ghost on-art' + (armed ? ' on' : '')}
              onClick={() => {
                if (!armed) {
                  setArmed(true)
                  return
                }
                deletePlaylist(pl.id)
                navigate({ kind: 'feed' })
                setStatus('Playlist deleted.')
              }}
            >
              <Icon name="trash" size={15} />
              {armed ? 'Tap again to delete' : 'Delete'}
            </button>
          </div>
        </div>
      </section>

      {pl.songs.length ? (
        <SongList
          songs={pl.songs}
          numbered
          onRemove={(songId) => {
            removeFromPlaylist(pl.id, songId)
            setStatus('Removed from playlist.')
          }}
        />
      ) : (
        <EmptyState icon="music" title="Empty playlist" hint="Tap + on any song to add it here." />
      )}
    </>
  )
}
