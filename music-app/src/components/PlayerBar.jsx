import { decodeHtml, fmt } from '../lib/format.js'
import { artistsOf, dlUrlFor, imgOf } from '../lib/song.js'
import { Icon } from './Icon.jsx'
import { useLibrary } from '../state/LibraryContext.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useUI } from '../state/UIContext.jsx'

/** The persistent transport. Left: what is playing. Middle: controls. Right: utilities. */
export function PlayerBar({ onDownload }) {
  const {
    current, isPlaying, clock, volume, currentQuality,
    togglePlay, nextTrack, prevTrack, seekFrac, setVolume, reloadActive,
  } = usePlayer()
  const { likedIds, toggleLike } = useLibrary()
  const s = useSettings()
  const { setFullOpen, setLyricsOpen } = useUI()

  const pct = clock.dur ? (clock.cur / clock.dur) * 100 : 0
  const liked = current ? likedIds.has(current.id) : false
  const openFull = () => current && setFullOpen(true)
  const name = current ? decodeHtml(current.name) : ''

  const seekFromEvent = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    seekFrac((e.clientX - r.left) / r.width)
  }
  const seekFromKey = (e) => {
    if (e.key === 'ArrowRight') seekFrac(Math.min(1, (clock.cur + 10) / (clock.dur || 1)))
    else if (e.key === 'ArrowLeft') seekFrac(Math.max(0, (clock.cur - 10) / (clock.dur || 1)))
    else return
    e.preventDefault()
  }

  return (
    <footer id="playerBar" className="player-bar">
      <div
        id="progressWrap"
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.max(1, Math.round(clock.dur || 0))}
        aria-valuenow={Math.round(clock.cur || 0)}
        aria-valuetext={`${fmt(clock.cur)} of ${fmt(clock.dur)}`}
        onClick={seekFromEvent}
        onKeyDown={seekFromKey}
      >
        <div id="progress" style={{ width: `${pct}%` }} />
      </div>

      <div className="pb-left">
        <img
          id="pThumb"
          alt=""
          src={current ? imgOf(current, s.dataSaver) : undefined}
          onClick={openFull}
        />
        <div id="pInfo" onClick={openFull}>
          <div id="pTitle">{current ? name : 'Nothing playing'}</div>
          <div id="pArtist">
            {current ? decodeHtml(artistsOf(current)) : 'Pick a song to start listening'}
          </div>
          <div id="pTime">
            {fmt(clock.cur)} / {fmt(clock.dur)}
          </div>
        </div>
      </div>

      <div className="controls">
        <button
          type="button"
          className={'cbtn' + (s.shuffle ? ' toggled' : '')}
          title={'Shuffle: ' + (s.shuffle ? 'on' : 'off')}
          aria-label={s.shuffle ? 'Turn shuffle off' : 'Turn shuffle on'}
          aria-pressed={s.shuffle}
          onClick={s.toggleShuffle}
        >
          <Icon name="shuffle" size={18} />
        </button>
        <button type="button" className="cbtn" title="Previous" aria-label="Previous track" onClick={prevTrack}>
          <Icon name="prev" size={18} />
        </button>
        <button
          type="button"
          className="cbtn main"
          title="Play / Pause"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={togglePlay}
        >
          <Icon name={isPlaying ? 'pause' : 'play'} size={20} />
        </button>
        <button type="button" className="cbtn" title="Next" aria-label="Next track" onClick={nextTrack}>
          <Icon name="next" size={18} />
        </button>
        <button
          type="button"
          className={
            'cbtn' + (s.repeat === 'off' ? ' dim' : '') + (s.repeat === 'one' ? ' toggled' : '')
          }
          title={'Repeat: ' + s.repeat}
          aria-label={`Repeat: ${s.repeat}. Change repeat mode`}
          onClick={s.cycleRepeat}
        >
          <Icon name={s.repeat === 'one' ? 'repeatOne' : 'repeat'} size={18} />
        </button>
      </div>

      <div className="p-right">
        <button
          type="button"
          className={'icon-btn' + (liked ? ' liked' : '')}
          title="Like"
          aria-label={liked ? 'Unlike this song' : 'Like this song'}
          aria-pressed={liked}
          onClick={() => current && toggleLike(current)}
        >
          <Icon name={liked ? 'heartFilled' : 'heart'} size={18} />
        </button>
        <select
          id="quality"
          aria-label="Audio quality"
          title={s.dataSaver ? 'Locked to the lowest quality by Data Saver' : 'Audio quality'}
          disabled={s.dataSaver || !current}
          value={currentQuality}
          onChange={(e) => {
            s.setQualityPref(e.target.value)
            // Defer: the context value the engine reads updates on the next tick.
            setTimeout(reloadActive, 0)
          }}
        >
          {(current?.downloadUrl || []).map((d) => (
            <option key={d.quality} value={d.quality}>
              {d.quality}
            </option>
          ))}
        </select>
        <input
          id="vol"
          type="range"
          min="0"
          max="100"
          aria-label="Volume"
          title="Volume"
          value={Math.round(volume * 100)}
          onChange={(e) => setVolume(e.target.value / 100)}
        />
        <a
          id="dlBtn"
          title="Download audio"
          aria-label="Download audio"
          href={current ? dlUrlFor(current, currentQuality) : '#'}
          onClick={onDownload}
        >
          <Icon name="download" size={19} />
        </a>
        <button
          type="button"
          className="icon-btn"
          title="Synced lyrics"
          aria-label="Open synced lyrics"
          onClick={() => current && setLyricsOpen(true)}
        >
          <Icon name="lyrics" size={19} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Full-screen player"
          aria-label="Open the full-screen player"
          onClick={openFull}
        >
          <Icon name="expand" size={18} />
        </button>
      </div>

      {!name && <span className="sr-only">No track selected</span>}
    </footer>
  )
}
