import { memo } from 'react'
import { decodeHtml, fmt } from '../lib/format.js'
import { artistsOf, imgOf } from '../lib/song.js'

/**
 * One row in any song list. `trailing` swaps the "add to playlist" control for
 * a remove button when the row is shown inside a user playlist.
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
  return (
    <div className={'song-row' + (playing ? ' playing' : '')} onClick={onPlay}>
      <img
        src={imgOf(song, dataSaver)}
        loading="lazy"
        alt=""
        onError={(e) => {
          e.currentTarget.style.opacity = 0.25
        }}
      />
      <div className="eq">
        <i />
        <i />
        <i />
      </div>
      <div className="s-info">
        <div className="s-title">
          {num ? `${num}. ` : ''}
          {decodeHtml(song.name)}
        </div>
        <div className="s-artist">{decodeHtml(artistsOf(song))}</div>
      </div>
      <div className="s-album">{decodeHtml(song.album?.name || '')}</div>
      <button
        className={'like-btn' + (liked ? ' liked' : '')}
        title="Like"
        onClick={stop(onLike)}
      >
        {liked ? '♥' : '♡'}
      </button>
      {onRemove ? (
        <button className="rm-btn" title="Remove from playlist" onClick={stop(onRemove)}>
          ✕
        </button>
      ) : (
        <button className="pl-btn" title="Add to playlist" onClick={stop(onAddToPlaylist)}>
          ＋
        </button>
      )}
      <button className="radio-btn" title="Start radio from here" onClick={stop(onRadio)}>
        📻
      </button>
      <div className="s-dur">{fmt(song.duration)}</div>
    </div>
  )
})
