import { decodeHtml, fmt } from '../lib/format.js'
import { shareVibexLink } from '../lib/shareUrl.js'
import { artistsOf, dlUrlFor, imgOf } from '../lib/song.js'
import { Icon } from './Icon.jsx'
import { RecBadge, TransitionBadge } from './Provenance.jsx'
import { useLibrary } from '../state/LibraryContext.jsx'
import { usePlayerClock, usePlayerTransport } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'

/** Isolated clock slider: updates smoothly on `timeupdate` without re-rendering PlayerBar buttons. */
function PlayerProgressSlider({ seekFrac }) {
  const clock = usePlayerClock()
  const pct = clock.dur ? (clock.cur / clock.dur) * 100 : 0

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
  )
}

function PlayerTimeReadout() {
  const clock = usePlayerClock()
  return (
    <div id="pTime">
      {fmt(clock.cur)} / {fmt(clock.dur)}
    </div>
  )
}

/** The persistent transport. Subscribes strictly to transport state — zero `timeupdate` churn. */
export function PlayerBar({ onDownload }) {
  const {
    current,
    currentIndex,
    isPlaying,
    volume,
    currentQuality,
    transition,
    togglePlay,
    nextTrack,
    prevTrack,
    seekFrac,
    setVolume,
    reloadActive,
    dismissRecommendation,
    clearForcedQuality,
    pipSupported,
    pipActive,
    togglePip,
  } = usePlayerTransport()
  const { likedIds, toggleLike } = useLibrary()
  const s = useSettings()
  const { setStatus } = useStatus()
  const { setFullOpen, setLyricsOpen, setDspOpen } = useUI()

  const liked = current ? likedIds.has(current.id) : false
  const openFull = () => current && setFullOpen(true)
  const name = current ? decodeHtml(current.name) : ''
  const eqActive = Boolean(
    s.dsp?.eqOn || s.dsp?.loudnessNorm || s.dsp?.slowedReverb || Number(s.dsp?.reverbMix) > 0
  )

  const handleShare = async () => {
    if (!current) return
    const out = await shareVibexLink({
      title: `${name} — ${decodeHtml(artistsOf(current))}`,
      text: `Listen to “${name}” on VIBEX`,
      pathOrUrl: `/?play=${encodeURIComponent(current.id)}`,
    })
    if (out.copied) setStatus('Copied song deep link to clipboard.')
  }

  return (
    <footer id="playerBar" className="player-bar">
      <PlayerProgressSlider seekFrac={seekFrac} />

      <div className="pb-left">
        <img
          id="pThumb"
          alt=""
          src={current ? imgOf(current, s.dataSaver) : undefined}
          onClick={openFull}
        />
        <div id="pInfo" onClick={openFull}>
          <div id="pTitle">
            {current ? name : 'Nothing playing'}
            <TransitionBadge transition={transition} compact />
          </div>
          <div id="pArtist">
            {current ? decodeHtml(artistsOf(current)) : 'Pick a song to start listening'}
            {current?._prov && (
              <RecBadge
                prov={current._prov}
                onDismiss={() => dismissRecommendation(currentIndex)}
              />
            )}
          </div>
          <PlayerTimeReadout />
        </div>
      </div>

      <div className="controls">
        <button
          type="button"
          className={
            'cbtn' +
            (s.shuffleMode !== 'off' ? ' toggled' : '') +
            (s.shuffleMode === 'smart' ? ' smart' : '')
          }
          title={
            s.shuffleMode === 'smart'
              ? 'Smart shuffle: queue order kept, suggestions mixed in'
              : s.shuffleMode === 'on'
                ? 'Shuffle: on'
                : 'Shuffle: off'
          }
          aria-label={
            s.shuffleMode === 'smart'
              ? 'Smart shuffle on. Change shuffle mode'
              : s.shuffleMode === 'on'
                ? 'Shuffle on. Change shuffle mode'
                : 'Shuffle off. Change shuffle mode'
          }
          aria-pressed={s.shuffleMode !== 'off'}
          onClick={s.cycleShuffle}
        >
          <Icon name={s.shuffleMode === 'smart' ? 'sparkle' : 'shuffle'} size={18} />
        </button>
        <button
          type="button"
          className="cbtn"
          title="Previous"
          aria-label="Previous track"
          onClick={prevTrack}
        >
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
        <button
          type="button"
          className="cbtn"
          title="Next"
          aria-label="Next track"
          onClick={nextTrack}
        >
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
            clearForcedQuality()
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
        <button
          type="button"
          className={'icon-btn' + (eqActive ? ' toggled' : '')}
          title="Studio EQ & Audio FX"
          aria-label="Open Studio EQ and audio effects"
          aria-pressed={eqActive}
          onClick={() => setDspOpen(true)}
        >
          <Icon name="sliders" size={18} />
        </button>
        {pipSupported && (
          <button
            type="button"
            className={'icon-btn' + (pipActive ? ' toggled' : '')}
            title="Floating Mini Player"
            aria-label="Toggle floating mini player"
            aria-pressed={pipActive}
            onClick={togglePip}
          >
            <Icon name="pip" size={18} />
          </button>
        )}
        {current && (
          <button
            type="button"
            className="icon-btn"
            title="Share deep link"
            aria-label="Share song link"
            onClick={handleShare}
          >
            <Icon name="share" size={18} />
          </button>
        )}
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
