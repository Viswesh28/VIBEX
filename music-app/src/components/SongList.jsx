import { SongRow } from './SongRow.jsx'
import { useLibrary } from '../state/LibraryContext.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useUI } from '../state/UIContext.jsx'

/**
 * Renders `songs` and, on click, makes that list the queue. `numbered` matches
 * the album/playlist presentation; search results are unnumbered.
 */
export function SongList({ songs, numbered = false, onRemove = null }) {
  const { likedIds, toggleLike } = useLibrary()
  const { queue, currentIndex, playFromList, startRadioFrom } = usePlayer()
  const { dataSaver } = useSettings()
  const { openPlaylistModal } = useUI()

  const isCurrentList = queue.length === songs.length && queue.every((s, i) => s.id === songs[i]?.id)

  return (
    <div>
      {songs.map((s, i) => (
        <SongRow
          key={`${s.id}-${i}`}
          song={s}
          num={numbered ? i + 1 : 0}
          playing={isCurrentList && i === currentIndex}
          liked={likedIds.has(s.id)}
          dataSaver={dataSaver}
          onPlay={() => playFromList(songs, i)}
          onLike={() => toggleLike(s)}
          onAddToPlaylist={() => openPlaylistModal(s)}
          onRemove={onRemove ? () => onRemove(s.id) : null}
          onRadio={() => startRadioFrom(s)}
        />
      ))}
    </div>
  )
}
