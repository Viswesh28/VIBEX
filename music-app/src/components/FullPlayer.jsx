import { decodeHtml, fmt } from '../lib/format.js'
import { artistsOf, dlUrlFor, estimate, firstArtistId, imgOf } from '../lib/song.js'
import { Icon } from './Icon.jsx'
import { useLibrary } from '../state/LibraryContext.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useUI } from '../state/UIContext.jsx'

/**
 * Immersive player. The artwork is the whole design: a blurred copy becomes
 * the backdrop, the sharp copy is the subject, and one red control carries
 * the action. Everything else is quiet until you look for it.
 */
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
    <div id="fullPlayer" className={'full-player' + (open ? ' open' : '')}>
      <div id="fpBg" style={{ backgroundImage: img ? `url("${img}")` : 'none' }} aria-hidden="true" />
      <div id="fpShade" onClick={() => setFullOpen(false)} aria-hidden="true" />
      <div id="fpInner" role="dialog" aria-modal="true" aria-label="Full-screen player">
        <div id="fpTop">
          <span className="eyebrow">
            <span className="dot" aria-hidden="true" />
            Now playing
          </span>
          <button
            type="button"
            id="fpClose"
            title="Close (Esc)"
            aria-label="Close the full-screen player"
            onClick={() => setFullOpen(false)}
          >
            <Icon name="chevronDown" size={20} />
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
              role="slider"
              tabIndex={0}
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Math.max(1, Math.round(clock.dur || 0))}
              aria-valuenow={Math.round(clock.cur || 0)}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                seekFrac((e.clientX - r.left) / r.width)
              }}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                const delta = e.key === 'ArrowRight' ? 10 : -10
                seekFrac(Math.min(1, Math.max(0, (clock.cur + delta) / (clock.dur || 1))))
                e.preventDefault()
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
                type="button"
                className={'cbtn' + (s.shuffle ? ' toggled' : '')}
                title="Shuffle"
                aria-label={s.shuffle ? 'Turn shuffle off' : 'Turn shuffle on'}
                aria-pressed={s.shuffle}
                onClick={s.toggleShuffle}
              >
                <Icon name="shuffle" size={19} />
              </button>
              <button type="button" className="cbtn" title="Previous" aria-label="Previous track" onClick={prevTrack}>
                <Icon name="prev" size={20} />
              </button>
              <button
                type="button"
                className="cbtn main"
                title="Play / Pause"
                aria-label={isPlaying ? 'Pause' : 'Play'}
                onClick={togglePlay}
              >
                <Icon name={isPlaying ? 'pause' : 'play'} size={24} />
              </button>
              <button type="button" className="cbtn" title="Next" aria-label="Next track" onClick={nextTrack}>
                <Icon name="next" size={20} />
              </button>
              <button
                type="button"
                className={
                  'cbtn' + (s.repeat === 'off' ? ' dim' : '') + (s.repeat === 'one' ? ' toggled' : '')
                }
                title="Repeat"
                aria-label={`Repeat: ${s.repeat}. Change repeat mode`}
                onClick={s.cycleRepeat}
              >
                <Icon name={s.repeat === 'one' ? 'repeatOne' : 'repeat'} size={19} />
              </button>
            </div>

            <div id="fpActions">
              <button
                type="button"
                className={'icon-btn' + (liked ? ' liked' : '')}
                title="Like"
                aria-label={liked ? 'Unlike this song' : 'Like this song'}
                aria-pressed={liked}
                onClick={() => current && toggleLike(current)}
              >
                <Icon name={liked ? 'heartFilled' : 'heart'} size={20} />
              </button>
              <a
                id="fpDlBtn"
                title="Click to download (right-click → Save link as also works)"
                aria-label="Download this song"
                href={current ? dlUrlFor(current, currentQuality) : '#'}
                onClick={onDownload}
              >
                <Icon name="download" size={17} />
                Download
              </a>
              <button
                type="button"
                className={'icon-btn' + (s.radio ? ' toggled' : '')}
                title="Radio"
                aria-label={s.radio ? 'Turn radio off' : 'Turn radio on'}
                aria-pressed={s.radio}
                onClick={() => s.setRadio(!s.radio)}
              >
                <Icon name="radio" size={20} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="Synced lyrics"
                aria-label="Open synced lyrics"
                onClick={() => setLyricsOpen(true)}
              >
                <Icon name="lyrics" size={20} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="Add to playlist"
                aria-label="Add this song to a playlist"
                onClick={() => current && openPlaylistModal(current)}
              >
                <Icon name="plus" size={20} />
              </button>
            </div>

            <div id="fpMeta">
              {current
                ? `${currentQuality} · ~${est.songMB.toFixed(1)} MB · playback streams from the source CDN`
                : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
