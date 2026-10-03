import { useEffect, useState } from 'react'
import { decodeHtml } from '../lib/format.js'
import { imgOf } from '../lib/song.js'
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
    onTitle?.('🎵 ' + decodeHtml(pl.name), `(${pl.songs.length} songs)`)
    setStatus(pl.songs.length ? 'Click a song to play.' : 'Empty playlist — add songs with ＋.')
  }, [pl, onTitle, setStatus])

  // Give the "are you sure" state a moment, then disarm.
  useEffect(() => {
    if (!armed) return undefined
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])

  if (!pl) return <EmptyState icon="🎵" title="Playlist not found" />

  return (
    <>
      <div className="detail-head">
        {pl.songs.length ? (
          <img
            src={imgOf(pl.songs[0], dataSaver)}
            alt=""
            onError={(e) => {
              e.currentTarget.style.opacity = 0.25
            }}
          />
        ) : (
          <div
            style={{
              width: 150, height: 150, borderRadius: 14, background: 'var(--card)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56,
            }}
          >
            🎵
          </div>
        )}
        <div>
          <h3>{decodeHtml(pl.name)}</h3>
          <p>Your custom playlist • saved on this device</p>
          <button onClick={() => pl.songs.length && playFromList(pl.songs, 0)}>▶ Play all</button>{' '}
          <button className="ghost" onClick={() => openRenameModal(pl.id, pl.name)}>
            ✏️ Rename
          </button>{' '}
          <button
            className="ghost"
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
            {armed ? '⚠️ Sure?' : '🗑 Delete'}
          </button>
        </div>
      </div>
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
        <EmptyState icon="🎵" title="Empty playlist" hint="Hover any song and tap ＋ to add it here." />
      )}
    </>
  )
}
