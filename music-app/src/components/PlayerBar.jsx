import { decodeHtml, fmt } from '../lib/format.js'
import { artistsOf, dlUrlFor, imgOf } from '../lib/song.js'
import { useLibrary } from '../state/LibraryContext.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useUI } from '../state/UIContext.jsx'

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

  return (
    <footer id="playerBar">
      <div
        id="progressWrap"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          seekFrac((e.clientX - r.left) / r.width)
        }}
      >
        <div id="progress" style={{ width: `${pct}%` }} />
      </div>

      <img id="pThumb" alt="" src={current ? imgOf(current, s.dataSaver) : undefined} onClick={openFull} />
      <div id="pInfo" onClick={openFull}>
        <div id="pTitle">{current ? decodeHtml(current.name) : 'Nothing playing'}</div>
        <div id="pArtist">{current ? decodeHtml(artistsOf(current)) : 'Search and pick a song'}</div>
        <div id="pTime">
          {fmt(clock.cur)} / {fmt(clock.dur)}
        </div>
      </div>

      <div className="controls">
        <button
          className={'cbtn' + (s.shuffle ? ' toggled' : '')}
          title={'Shuffle: ' + (s.shuffle ? 'on' : 'off')}
          onClick={s.toggleShuffle}
        >
          🔀
        </button>
        <button className="cbtn" title="Previous" onClick={prevTrack}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zM18 6l-8.5 6L18 18z" />
          </svg>
        </button>
        <button className="cbtn main" title="Play/Pause" onClick={togglePlay}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            {isPlaying ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
          </svg>
        </button>
        <button className="cbtn" title="Next" onClick={nextTrack}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z" />
          </svg>
        </button>
        <button
          className={
            'cbtn' + (s.repeat === 'off' ? ' dim' : '') + (s.repeat === 'one' ? ' toggled' : '')
          }
          title={'Repeat: ' + s.repeat}
          onClick={s.cycleRepeat}
        >
          {s.repeat === 'one' ? '🔂' : '🔁'}
        </button>
      </div>

      <div className="p-right">
        <button
          className={'icon-btn' + (liked ? ' liked' : '')}
          title="Like"
          onClick={() => current && toggleLike(current)}
        >
          {liked ? '♥' : '♡'}
        </button>
        <select
          id="quality"
          title={s.dataSaver ? 'Locked to lowest quality by Data Saver (Beta)' : 'Audio quality'}
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
          title="Volume"
          value={Math.round(volume * 100)}
          onChange={(e) => setVolume(e.target.value / 100)}
        />
        <a
          id="dlBtn"
          title="Download audio"
          href={current ? dlUrlFor(current, currentQuality) : '#'}
          onClick={onDownload}
        >
          ⬇️
        </a>
        <button className="icon-btn" title="Full-screen player" onClick={openFull}>
          ⛶
        </button>
        <button className="icon-btn" title="Synced lyrics" onClick={() => current && setLyricsOpen(true)}>
          🎤
        </button>
      </div>
    </footer>
  )
}
