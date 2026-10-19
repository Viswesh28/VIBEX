import { memo } from 'react'
import { decodeHtml, fmt } from '../lib/format.js'
import { artistsOf, imgOf } from '../lib/song.js'
import { Icon } from './Icon.jsx'

/**
 * One row in any song list. `onRemove` swaps the "add to playlist" control for
 * a remove button when the row is shown inside a user playlist.
 *
 * The row itself is clickable, and the artwork carries a real play button so
 * the same action is reachable with a keyboard. Every icon-only control has an
 * aria-label: `title` alone is not announced reliably by TalkBack.
 */
export const SongRow = memo(function SongRow({
  song,
  num,
  playing,
  liked,
  dataSaver,
  onPlay,
  onLike,
  onAddToPlaylist,
  onRemove,
  onRadio,
}) {
  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn()
  }
  const title = decodeHtml(song.name)
  const artist = decodeHtml(artistsOf(song))

  return (
    <div
      className={'song-row' + (playing ? ' playing' : '')}
      onClick={onPlay}
      aria-current={playing ? 'true' : undefined}
    >
      <div className="s-art">
        <img
          src={imgOf(song, dataSaver)}
          loading="lazy"
          alt=""
          onError={(e) => {
            e.currentTarget.style.opacity = 0.25
          }}
        />
        <button
          type="button"
          className="s-play"
          aria-label={`Play ${title}`}
          onClick={stop(onPlay)}
        >
          <Icon name="play" size={15} />
        </button>
        <span className="eq" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>

      <div className="s-info">
        <div className="s-title">
          {num ? `${num}. ` : ''}
          {title}
        </div>
        <div className="s-artist">{artist}</div>
      </div>

      <div className="s-album">{decodeHtml(song.album?.name || '')}</div>

      <button
        type="button"
        className={'like-btn' + (liked ? ' liked' : '')}
        title="Like"
        aria-label={liked ? `Unlike ${title}` : `Like ${title}`}
        aria-pressed={!!liked}
        onClick={stop(onLike)}
      >
        <Icon name={liked ? 'heartFilled' : 'heart'} size={18} />
      </button>

      {onRemove ? (
        <button
          type="button"
          className="rm-btn"
          title="Remove from playlist"
          aria-label={`Remove ${title} from playlist`}
          onClick={stop(onRemove)}
        >
          <Icon name="close" size={16} />
        </button>
      ) : (
        <button
          type="button"
          className="pl-btn"
          title="Add to playlist"
          aria-label={`Add ${title} to a playlist`}
          onClick={stop(onAddToPlaylist)}
        >
          <Icon name="plus" size={18} />
        </button>
      )}

      <button
        type="button"
        className="radio-btn"
        title="Start radio from here"
        aria-label={`Start radio from ${title}`}
        onClick={stop(onRadio)}
      >
        <Icon name="radio" size={17} />
      </button>

      <div className="s-dur">{fmt(song.duration)}</div>
    </div>
  )
})
