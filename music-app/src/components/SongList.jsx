import { memo, useCallback } from 'react'
import { SongRow } from './SongRow.jsx'
import { useLibrary } from '../state/LibraryContext.jsx'
import { usePlayerTransport } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useUI } from '../state/UIContext.jsx'
import { artistsOf } from '../lib/song.js'

/**
 * Renders `songs` and, on click, makes that list the queue. `numbered` matches
 * the album/playlist presentation; search results are unnumbered.
 *
 * Uses clock-free `usePlayerTransport` + stable callbacks so 100-row tracklists
 * never re-render on `timeupdate` ticks and single-row likes only touch 1 row.
 */
export const SongList = memo(function SongList({
  songs,
  numbered = false,
  onRemove = null,
  allowExclude = false,
  onExclude = null,
}) {
  const { likedIds, toggleLike } = useLibrary()
  const { queue, currentIndex, playFromList, startRadioFrom } = usePlayerTransport()
  const { dataSaver } = useSettings()
  const { openPlaylistModal } = useUI()

  const isCurrentList = queue.length === songs.length && queue.every((s, i) => s.id === songs[i]?.id)

  const handlePlay = useCallback(
    (_song, idx) => {
      playFromList(songs, idx)
    },
    [playFromList, songs]
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
          dataSaver={dataSaver}
          onPlay={handlePlay}
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
