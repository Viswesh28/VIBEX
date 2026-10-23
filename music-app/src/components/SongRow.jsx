import { memo } from 'react'
import { decodeHtml, fmt } from '../lib/format.js'
import { artistsOf, imgOf } from '../lib/song.js'
import { isYtTrack } from '../lib/sources.js'
import { Icon } from './Icon.jsx'

/**
 * One row in any song list. Supports instant play, Play Next, Offline Pin,
 * Like, Add/Remove Playlist, Artist Exclude, and Radio.
 */
export const SongRow = memo(function SongRow({
  song,
  index = 0,
  num,
  playing,
  liked,
  pinned = false,
  pinning = false,
  dataSaver,
  onPlay,
  onPlayNext,
  onTogglePin,
  onLike,
  onAddToPlaylist,
  onRemove,
  onRadio,
  onExclude,
}) {
  const firePlay = () => onPlay?.(song, index)
  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn?.(song, index)
  }
  const title = decodeHtml(song.name)
  const artist = decodeHtml(artistsOf(song))

  return (
    <div
      className={
        'song-row' +
        (playing ? ' playing' : '') +
        (onExclude ? ' with-exclude' : '') +
        (onPlayNext || onTogglePin ? ' with-queue-ops' : '')
      }
      onClick={firePlay}
      aria-current={playing ? 'true' : undefined}
    >
      <div className="s-art">
        <img
          src={imgOf(song, dataSaver)}
          loading="lazy"
          decoding="async"
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
          {pinned && (
            <span className="src-badge offline-badge" title="Saved offline in browser vault">
              Offline
            </span>
          )}
          {isYtTrack(song) && (
            <span
              className="src-badge"
              title="Matched from YouTube Music — plays as pure audio"
            >
              YT
            </span>
          )}
        </div>
        <div className="s-artist">{artist}</div>
      </div>

      <div className="s-album">{decodeHtml(song.album?.name || '')}</div>

      {onPlayNext && (
        <button
          type="button"
          className="qnext-btn"
          title="Play next"
          aria-label={`Play ${title} next`}
          onClick={stop(onPlayNext)}
        >
          <Icon name="queueNext" size={17} />
        </button>
      )}

      {onTogglePin && (
        <button
          type="button"
          className={'pin-btn' + (pinned ? ' pinned' : '')}
          title={pinned ? 'Remove offline copy' : 'Save offline'}
          aria-label={pinned ? `Remove offline copy of ${title}` : `Save ${title} offline`}
          aria-pressed={!!pinned}
          disabled={pinning}
          onClick={stop(onTogglePin)}
        >
          <Icon name="pin" size={17} />
        </button>
      )}

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

      {onExclude && (
        <button
          type="button"
          className="excl-btn"
          title="Don't suggest this artist"
          aria-label={`Don't suggest ${artist}`}
          onClick={stop(onExclude)}
        >
          <Icon name="ban" size={16} />
        </button>
      )}

      <div className="s-dur">{fmt(song.duration)}</div>
    </div>
  )
})
