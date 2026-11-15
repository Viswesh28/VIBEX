import { memo, useCallback } from 'react'
import { SongRow } from './SongRow.jsx'
import { useLibrary } from '../state/LibraryContext.jsx'
import { usePlayerTransport } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'
import { artistsOf } from '../lib/song.js'
import { decodeHtml } from '../lib/format.js'

/**
 * Renders `songs` with clock-free `usePlayerTransport` + stable callbacks.
 * Supports Play, Play Next, Offline Pin, Like, Add/Remove Playlist, and Radio.
 */
export const SongList = memo(function SongList({
  songs,
  numbered = false,
  onRemove = null,
  allowExclude = false,
  onExclude = null,
}) {
  const { likedIds, toggleLike, offlineIds, offlineBusyIds, toggleOfflinePin } = useLibrary()
  const { queue, currentIndex, playFromList, playNext, startRadioFrom } = usePlayerTransport()
  const { dataSaver } = useSettings()
  const { setStatus } = useStatus()
  const { openPlaylistModal } = useUI()

  const isCurrentList = queue.length === songs.length && queue.every((s, i) => s.id === songs[i]?.id)

  const handlePlay = useCallback(
    (_song, idx) => {
      playFromList(songs, idx)
    },
    [playFromList, songs]
  )

  const handlePlayNext = useCallback(
    (song) => {
      playNext(song)
    },
    [playNext]
  )

  const handleTogglePin = useCallback(
    async (song) => {
      try {
        const pinnedNow = await toggleOfflinePin(song)
        setStatus(
          pinnedNow
            ? `Saved “${decodeHtml(song.name)}” offline — plays with zero network.`
            : `Removed offline copy of “${decodeHtml(song.name)}”.`
        )
      } catch (err) {
        setStatus(err?.message || 'Could not cache song offline right now.', true)
      }
    },
    [setStatus, toggleOfflinePin]
  )

  const handleLike = useCallback(
    (song) => {
      toggleLike(song)
    },
    [toggleLike]
  )

  const handleAddToPlaylist = useCallback(
    (song) => {
      openPlaylistModal(song)
    },
    [openPlaylistModal]
  )

  const handleRadio = useCallback(
    (song) => {
      startRadioFrom(song)
    },
    [startRadioFrom]
  )

  const handleRemove = useCallback(
    (song) => {
      onRemove?.(song.id)
    },
    [onRemove]
  )

  const handleExclude = useCallback(
    (song) => {
      onExclude?.(artistsOf(song).split(',')[0].trim())
    },
    [onExclude]
  )

  return (
    <div className="song-list">
      {songs.map((s, i) => (
        <SongRow
          key={`${s.id}-${i}`}
          song={s}
          index={i}
          num={numbered ? i + 1 : 0}
          playing={isCurrentList && i === currentIndex}
          liked={likedIds.has(s.id)}
          pinned={offlineIds.has(s.id)}
          pinning={offlineBusyIds.has(s.id)}
          dataSaver={dataSaver}
          onPlay={handlePlay}
          onPlayNext={handlePlayNext}
          onTogglePin={handleTogglePin}
          onLike={handleLike}
          onAddToPlaylist={handleAddToPlaylist}
          onRemove={onRemove ? handleRemove : null}
          onRadio={handleRadio}
          onExclude={allowExclude && onExclude ? handleExclude : null}
        />
      ))}
    </div>
  )
})
