import { useState } from 'react'
import { decodeHtml } from '../lib/format.js'
import { artistsOf, dlUrlFor, estimate, firstArtistId, imgOf } from '../lib/song.js'
import { store } from '../lib/storage.js'
import { Icon } from './Icon.jsx'
import { RecBadge, StopNote, TransitionBadge } from './Provenance.jsx'
import { LyricsBody } from './LyricsBody.jsx'
import { QueueList } from './QueueList.jsx'
import { Visualizer } from './Visualizer.jsx'
import { useLyrics } from '../hooks/useLyrics.js'
import { useLibrary } from '../state/LibraryContext.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'

/** The right rail: artwork, transport of the current track, lyrics and queue. */
export function NowPlaying({ onDownload }) {
  const {
    current, currentIndex, isPlaying, clock, togglePlay, seekFrac, queue, currentQuality,
    transition, stopReason, dismissRecommendation, startRadioFrom, playTrack,
  } = usePlayer()
  const { likedIds, toggleLike } = useLibrary()
  const { dataSaver, viz, radio, setRadio } = useSettings()
  const { setStatus } = useStatus()
  const { navigate } = useUI()

  const [tab, setTab] = useState(() => {
    const t = store.get('svNpTab', 'viz')
    return t === 'lyr' || t === 'viz' ? t : 'viz'
  })
  const effTab = viz.on ? tab : 'lyr'
  const { res, activeIdx } = useLyrics(current, effTab === 'lyr')

  const pct = clock.dur ? (clock.cur / clock.dur) * 100 : 0
  const liked = current ? likedIds.has(current.id) : false
  const est = estimate(currentQuality, current?.duration)

  const pick = (t) => {
    setTab(t)
    store.set('svNpTab', t)
  }

  return (
    <aside id="nowplaying" aria-label="Now playing">
      <div className="np-head">
        <span>Now playing</span>
        <Icon name="queue" size={16} />
      </div>

      <div id="npArtWrap">
        {!current && (
          <div className="np-empty" id="npEmpty">
            <Icon name="music" size={38} />
            <span>Pick a song to play</span>
          </div>
        )}
        <img id="npCover" alt="" src={current ? imgOf(current, dataSaver) : undefined} style={{ opacity: current ? 1 : 0 }} />
        <TransitionBadge transition={transition} />
        <button
          type="button"
          id="npPlayOverlay"
          title="Play/Pause"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={togglePlay}
        >
          <span className="np-circle">
            <Icon name={isPlaying ? 'pause' : 'play'} size={22} />
          </span>
        </button>
        <div
          id="npProg"
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
          <div id="npProgFill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="np-meta">
        <div id="npTitle">{current ? decodeHtml(current.name) : 'Nothing playing'}</div>
        <div
          id="npArtist"
          title="Open artist page"
          onClick={() => {
            const aid = firstArtistId(current)
            if (aid) navigate({ kind: 'artist', id: aid })
            else setStatus('No artist page for this song.')
          }}
        >
          {current ? decodeHtml(artistsOf(current)) : 'Search and pick a song'}
        </div>
        <div id="npAlbum">{current ? decodeHtml(current.album?.name || '') : ''}</div>
        {current?._prov && (
          <div className="np-why">
            <RecBadge prov={current._prov} onDismiss={() => dismissRecommendation(currentIndex)} />
            <span>
              {current._prov.kind === 'smart_insert'
                ? 'One of a few suggestions mixed into your queue.'
                : 'Plays after your queue, so the music keeps going.'}
            </span>
          </div>
        )}
      </div>

      <div className="np-actions">
        <button
          type="button"
          className={'icon-btn' + (liked ? ' liked' : '')}
          title="Like"
          aria-label={liked ? 'Unlike this song' : 'Like this song'}
          aria-pressed={liked}
          onClick={() => current && toggleLike(current)}
        >
          <Icon name={liked ? 'heartFilled' : 'heart'} size={19} />
        </button>
        <a
          id="npDl"
          className="icon-btn"
          title="Download audio"
          aria-label="Download audio"
          href={current ? dlUrlFor(current, currentQuality) : '#'}
          onClick={onDownload}
        >
          <Icon name="download" size={19} />
        </a>
        <button
          type="button"
          className={'icon-btn' + (radio ? ' toggled' : '')}
          title={'Radio: ' + (radio ? 'on — endless station' : 'off')}
          aria-label={radio ? 'Turn radio off' : 'Turn radio on'}
          aria-pressed={radio}
          onClick={() => {
            setRadio(!radio)
            setStatus(radio ? 'Radio off.' : "Radio on — I'll keep similar songs coming.")
          }}
        >
          <Icon name="radio" size={19} />
        </button>
        <span id="npEst">{current ? `${currentQuality} · ~${est.songMB.toFixed(1)} MB` : ''}</span>
      </div>

      <div id="npTabs" role="tablist" aria-label="Now playing panel">
        <button
          type="button"
          role="tab"
          aria-selected={effTab === 'viz'}
          className={'np-tab' + (effTab === 'viz' ? ' active' : '')}
          onClick={() => pick('viz')}
          disabled={!viz.on}
        >
          Visuals
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={effTab === 'lyr'}
          className={'np-tab' + (effTab === 'lyr' ? ' active' : '')}
          onClick={() => pick('lyr')}
        >
          Lyrics
        </button>
      </div>

      <Visualizer active={effTab === 'viz' && viz.on && !!current} />
      <div id="lyricsBox" style={{ display: effTab === 'lyr' ? 'block' : 'none' }}>
        <div id="lyricsContent">
          <LyricsBody res={current ? res : null} activeIdx={activeIdx} />
        </div>
        <div id="lyricsCredit">Lyrics by LRCLIB</div>
      </div>

      <StopNote
        stopReason={stopReason}
        onRetry={() => playTrack(currentIndex)}
        onRadio={() => startRadioFrom(current)}
      />

      <div className="np-head">
        <span>
          Queue {queue.length ? <span id="qCount">({queue.length})</span> : ''}
        </span>
        <QueueClear />
      </div>
      <QueueList />
    </aside>
  )
}

function QueueClear() {
  const { qClear } = usePlayer()
  return (
    <button
      type="button"
      id="qClear"
      className="icon-btn"
      title="Clear queue (keeps current)"
      aria-label="Clear the queue"
      onClick={qClear}
    >
      <Icon name="trash" size={16} />
    </button>
  )
}
