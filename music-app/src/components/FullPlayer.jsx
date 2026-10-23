import { useEffect, useRef, useState } from 'react'
import { decodeHtml, fmt } from '../lib/format.js'
import { shareOrDownloadLyricCard } from '../lib/lyricCard.js'
import { shareVibexLink } from '../lib/shareUrl.js'
import { artistsOf, dlUrlFor, estimate, firstArtistId, imgOf } from '../lib/song.js'
import { hasIndicScript } from '../lib/transliterate.js'
import { DspControls } from './DspRackModal.jsx'
import { Icon } from './Icon.jsx'
import { LyricsBody } from './LyricsBody.jsx'
import { RecBadge, TransitionBadge } from './Provenance.jsx'
import { QueueList } from './QueueList.jsx'
import { Visualizer } from './Visualizer.jsx'
import { useCanvasVideo } from '../hooks/useCanvasVideo.js'
import { useLyrics } from '../hooks/useLyrics.js'
import { useLibrary } from '../state/LibraryContext.jsx'
import { usePlayerClock, usePlayerTransport } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'

const FP_TABS = [
  { id: 'cover', label: 'Cover' },
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'queue', label: 'Up Next' },
  { id: 'viz', label: 'Visuals' },
  { id: 'eq', label: 'Studio EQ' },
]

function FullPlayerProgress({ seekFrac }) {
  const clock = usePlayerClock()
  const pct = clock.dur ? (clock.cur / clock.dur) * 100 : 0
  return (
    <>
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
    </>
  )
}

/**
 * Full-screen mobile & desktop player with unified tabs:
 * Cover · Lyrics (click-to-seek + Romanize + Lyric Card) · Up Next · Visuals · Studio EQ.
 */
export function FullPlayer({ onDownload }) {
  const {
    current,
    currentIndex,
    isPlaying,
    currentQuality,
    transition,
    togglePlay,
    nextTrack,
    prevTrack,
    seekFrac,
    seekTo,
    dismissRecommendation,
  } = usePlayerTransport()
  const { likedIds, toggleLike } = useLibrary()
  const s = useSettings()
  const { setStatus } = useStatus()
  const { fullOpen, setFullOpen, setLyricsOpen, openPlaylistModal, navigate } = useUI()

  const [tab, setTab] = useState('cover')
  const [romanize, setRomanize] = useState(false)
  const touchStartY = useRef(null)

  const open = fullOpen && !!current
  const img = current ? imgOf(current, s.dataSaver) : ''
  const liked = current ? likedIds.has(current.id) : false
  const est = estimate(currentQuality, current?.duration)

  const { res: lyrRes, activeIdx: lyrIdx } = useLyrics(current, open && tab === 'lyrics')
  const lyrSample =
    lyrRes?.type === 'synced'
      ? lyrRes.lines.map((l) => l.text).join(' ')
      : lyrRes?.type === 'plain'
        ? lyrRes.text
        : ''

  const { url: canvasUrl } = useCanvasVideo({
    track: current,
    open,
    dataSaver: s.dataSaver,
    enabled: s.canvas,
  })
  const videoRef = useRef(null)
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (isPlaying) v.play()?.catch(() => {})
    else v.pause()
  }, [isPlaying, canvasUrl, open])

  const handleShareSong = async () => {
    if (!current) return
    const out = await shareVibexLink({
      title: `${decodeHtml(current.name)} — ${decodeHtml(artistsOf(current))}`,
      text: `Listen to “${decodeHtml(current.name)}” on VIBEX`,
      pathOrUrl: `/?play=${encodeURIComponent(current.id)}`,
    })
    if (out.copied) setStatus('Copied song deep link to clipboard.')
  }

  return (
    <div
      id="fullPlayer"
      className={'full-player' + (open ? ' open' : '')}
      onTouchStart={(e) => {
        touchStartY.current = e.touches?.[0]?.clientY ?? null
      }}
      onTouchEnd={(e) => {
        if (touchStartY.current === null) return
        const dy = (e.changedTouches?.[0]?.clientY ?? touchStartY.current) - touchStartY.current
        touchStartY.current = null
        if (dy > 95 && tab === 'cover') setFullOpen(false)
      }}
    >
      {canvasUrl && (
        <video
          id="fpCanvas"
          ref={videoRef}
          className={isPlaying ? 'on' : ''}
          src={canvasUrl}
          muted
          loop
          playsInline
          preload="none"
          aria-hidden="true"
          onError={() => {
            if (videoRef.current) videoRef.current.style.opacity = '0'
          }}
        />
      )}
      <div
        id="fpBg"
        className={canvasUrl ? 'has-canvas' : ''}
        style={{ backgroundImage: img ? `url("${img}")` : 'none' }}
        aria-hidden="true"
      />
      <div id="fpShade" onClick={() => setFullOpen(false)} aria-hidden="true" />
      <div id="fpInner" role="dialog" aria-modal="true" aria-label="Full-screen player">
        <div id="fpTop">
          <div className="fp-tabs" role="tablist" aria-label="Full player sections">
            {FP_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={'chip fp-tab' + (tab === t.id ? ' active' : '')}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
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
          {tab === 'cover' && <img id="fpCover" alt="" src={img || undefined} />}
          {tab === 'lyrics' && (
            <div className="fp-stage-pane">
              <div className="lyr-tools">
                {hasIndicScript(lyrSample) && (
                  <button
                    type="button"
                    className={'chip' + (romanize ? ' active' : '')}
                    aria-pressed={romanize}
                    onClick={() => setRomanize((v) => !v)}
                  >
                    <Icon name="translate" size={14} /> Romanize
                  </button>
                )}
                <button
                  type="button"
                  className="chip"
                  onClick={async () => {
                    const lines =
                      lyrRes?.type === 'synced' && lyrRes.lines.length
                        ? lyrRes.lines
                            .slice(Math.max(0, lyrIdx), Math.max(0, lyrIdx) + 3)
                            .map((l) => l.text)
                        : [decodeHtml(current?.name || '')]
                    const out = await shareOrDownloadLyricCard({ track: current, lines })
                    setStatus(out.shared ? 'Shared lyric poster.' : 'Saved lyric card PNG.')
                  }}
                >
                  <Icon name="card" size={14} /> Share Card
                </button>
              </div>
              <LyricsBody
                res={lyrRes}
                activeIdx={lyrIdx}
                onSeekLine={seekTo}
                romanize={romanize}
              />
            </div>
          )}
          {tab === 'queue' && (
            <div className="fp-stage-pane">
              <QueueList />
            </div>
          )}
          {tab === 'viz' && (
            <div className="fp-stage-pane fp-viz-stage">
              <Visualizer active={open && tab === 'viz'} />
            </div>
          )}
          {tab === 'eq' && (
            <div className="fp-stage-pane">
              <DspControls />
            </div>
          )}

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
            {(current?._prov || transition.state === 'mixing') && (
              <div id="fpBadges">
                <TransitionBadge transition={transition} />
                {current?._prov && (
                  <RecBadge
                    prov={current._prov}
                    onDismiss={() => dismissRecommendation(currentIndex)}
                  />
                )}
              </div>
            )}

            <FullPlayerProgress seekFrac={seekFrac} />

            <div id="fpControls">
              <button
                type="button"
                className={
                  'cbtn' +
                  (s.shuffleMode !== 'off' ? ' toggled' : '') +
                  (s.shuffleMode === 'smart' ? ' smart' : '')
                }
                title={`Shuffle: ${s.shuffleMode}`}
                aria-label={`Shuffle: ${s.shuffleMode}. Change shuffle mode`}
                aria-pressed={s.shuffleMode !== 'off'}
                onClick={s.cycleShuffle}
              >
                <Icon name={s.shuffleMode === 'smart' ? 'sparkle' : 'shuffle'} size={19} />
              </button>
              <button
                type="button"
                className="cbtn"
                title="Previous"
                aria-label="Previous track"
                onClick={prevTrack}
              >
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
              <button
                type="button"
                className="cbtn"
                title="Next"
                aria-label="Next track"
                onClick={nextTrack}
              >
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
                title="Share deep link"
                aria-label="Share song link"
                onClick={handleShareSong}
              >
                <Icon name="share" size={19} />
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
                ? `${currentQuality} · ~${est.songMB.toFixed(1)} MB · playback streams as pure audio`
                : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
