import { decodeHtml, fmt } from '../lib/format.js'
import { artistsOf, dlUrlFor, estimate, firstArtistId, imgOf } from '../lib/song.js'
import { useLibrary } from '../state/LibraryContext.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useUI } from '../state/UIContext.jsx'

/** Spotify-style full-screen view of the current track. */
export function FullPlayer({ onDownload }) {
  const {
    current, isPlaying, clock, currentQuality,
    togglePlay, nextTrack, prevTrack, seekFrac,
  } = usePlayer()
  const { likedIds, toggleLike } = useLibrary()
  const s = useSettings()
  const { fullOpen, setFullOpen, setLyricsOpen, openPlaylistModal, navigate } = useUI()

  const open = fullOpen && !!current
  const img = current ? imgOf(current, s.dataSaver) : ''
  const pct = clock.dur ? (clock.cur / clock.dur) * 100 : 0
  const liked = current ? likedIds.has(current.id) : false
  const est = estimate(currentQuality, current?.duration)

  return (
    <div id="fullPlayer" className={open ? 'open' : ''}>
      <div id="fpBg" style={{ backgroundImage: img ? `url("${img}")` : 'none' }} />
      <div id="fpShade" onClick={() => setFullOpen(false)} />
      <div id="fpInner">
        <div id="fpTop">
          <span id="fpHint">♪ NOW PLAYING</span>
          <button id="fpClose" title="Close (Esc)" onClick={() => setFullOpen(false)}>
            ⌄
          </button>
        </div>
        <div id="fpMain">
          <img id="fpCover" alt="" src={img || undefined} />
          <div id="fpSide">
            <div id="fpTitle" title={current ? decodeHtml(current.name) : ''}>
              {current ? decodeHtml(current.name) : 'Nothing playing'}
            </div>
            <div
              id="fpArtist"
              onClick={() => {
                const aid = firstArtistId(current)
                if (aid) {
                  setFullOpen(false)
                  navigate({ kind: 'artist', id: aid })
                }
              }}
            >
              {current ? decodeHtml(artistsOf(current)) : ''}
            </div>
            <div id="fpAlbum">{current ? decodeHtml(current.album?.name || '') : ''}</div>
            <div
              id="fpProgWrap"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                seekFrac((e.clientX - r.left) / r.width)
              }}
            >
              <div id="fpProg" style={{ width: `${pct}%` }} />
            </div>
            <div id="fpTimes">
              <span id="fpCur">{fmt(clock.cur)}</span>
              <span id="fpTot">{fmt(clock.dur)}</span>
            </div>
            <div id="fpControls">
              <button
                className={'cbtn' + (s.shuffle ? ' toggled' : '')}
                title="Shuffle"
                onClick={s.toggleShuffle}
              >
                🔀
              </button>
              <button className="cbtn" title="Previous" onClick={prevTrack}>
                ⏮
              </button>
              <button className="cbtn main" title="Play/Pause" onClick={togglePlay}>
                {isPlaying ? '⏸' : '▶'}
              </button>
              <button className="cbtn" title="Next" onClick={nextTrack}>
                ⏭
              </button>
              <button
                className={
                  'cbtn' + (s.repeat === 'off' ? ' dim' : '') + (s.repeat === 'one' ? ' toggled' : '')
                }
                title="Repeat"
                onClick={s.cycleRepeat}
              >
                {s.repeat === 'one' ? '🔂' : '🔁'}
              </button>
            </div>
            <div id="fpActions">
              <button
                className={'icon-btn' + (liked ? ' liked' : '')}
                title="Like"
                onClick={() => current && toggleLike(current)}
              >
                {liked ? '♥' : '♡'}
              </button>
              <a
                id="fpDlBtn"
                title="Click to download (right-click → Save link as also works)"
                href={current ? dlUrlFor(current, currentQuality) : '#'}
                onClick={onDownload}
              >
                ⬇ Download
              </a>
              <button
                className={'icon-btn' + (s.radio ? ' toggled' : '')}
                title="Radio"
                onClick={() => s.setRadio(!s.radio)}
              >
                📻
              </button>
              <button className="icon-btn" title="Synced lyrics" onClick={() => setLyricsOpen(true)}>
                🎤
              </button>
              <button
                className="icon-btn"
                title="Add to playlist"
                onClick={() => current && openPlaylistModal(current)}
              >
                ＋
              </button>
            </div>
            <div id="fpMeta">
              {current
                ? `💾 ${currentQuality} • ~${est.songMB.toFixed(1)} MB • ⬇ saves the audio file to your device`
                : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
