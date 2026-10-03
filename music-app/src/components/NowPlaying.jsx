import { useState } from 'react'
import { decodeHtml } from '../lib/format.js'
import { artistsOf, dlUrlFor, estimate, firstArtistId, imgOf } from '../lib/song.js'
import { store } from '../lib/storage.js'
import { LyricsBody } from './LyricsBody.jsx'
import { QueueList } from './QueueList.jsx'
import { Visualizer } from './Visualizer.jsx'
import { useLyrics } from '../hooks/useLyrics.js'
import { useLibrary } from '../state/LibraryContext.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'

export function NowPlaying({ onDownload }) {
  const { current, isPlaying, clock, togglePlay, seekFrac, queue, currentQuality } = usePlayer()
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
    <aside id="nowplaying">
      <div className="np-sec-title">NOW PLAYING</div>

      <div id="npArtWrap">
        {!current && (
          <div className="np-empty" id="npEmpty" style={{ display: 'flex' }}>
            <b>🎵</b>
            <span>Pick a song to play</span>
          </div>
        )}
        <img
          id="npCover"
          alt=""
          src={current ? imgOf(current, dataSaver) : undefined}
          style={{ opacity: current ? 1 : 0 }}
        />
        <button id="npPlayOverlay" title="Play/Pause" onClick={togglePlay}>
          <span className="np-circle">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff">
              {isPlaying ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
            </svg>
          </span>
        </button>
        <div
          id="npProg"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            seekFrac((e.clientX - r.left) / r.width)
          }}
        >
          <div id="npProgFill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div>
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
      </div>

      <div className="np-actions">
        <button
          className={'icon-btn' + (liked ? ' liked' : '')}
          title="Like"
          onClick={() => current && toggleLike(current)}
        >
          {liked ? '♥' : '♡'}
        </button>
        <a
          id="npDl"
          className="icon-btn"
          title="Download audio"
          href={current ? dlUrlFor(current, currentQuality) : '#'}
          onClick={onDownload}
        >
          ⬇
        </a>
        <button
          className={'icon-btn' + (radio ? ' toggled' : '')}
          title={'Radio: ' + (radio ? 'on — endless station' : 'off')}
          onClick={() => {
            setRadio(!radio)
            setStatus(radio ? '📻 Radio off.' : "📻 Radio on — I'll keep similar songs coming.")
          }}
        >
          📻
        </button>
        <span id="npEst">
          {current ? `💾 ${currentQuality} · ~${est.songMB.toFixed(1)} MB` : ''}
        </span>
      </div>

      <div id="npTabs">
        <button
          className={'np-tab' + (effTab === 'viz' ? ' active' : '')}
          onClick={() => pick('viz')}
          disabled={!viz.on}
        >
          ✨ Visuals
        </button>
        <button className={'np-tab' + (effTab === 'lyr' ? ' active' : '')} onClick={() => pick('lyr')}>
          📜 Lyrics
        </button>
      </div>

      <Visualizer active={effTab === 'viz' && viz.on && !!current} />
      <div id="lyricsBox" style={{ display: effTab === 'lyr' ? 'block' : 'none' }}>
        <div id="lyricsContent">
          <LyricsBody res={current ? res : null} activeIdx={activeIdx} />
        </div>
        <div id="lyricsCredit">Lyrics by LRCLIB</div>
      </div>

      <div className="np-sec-title">
        QUEUE <span id="qCount">{queue.length ? `(${queue.length})` : ''}</span>
        <QueueClear />
      </div>
      <QueueList />
    </aside>
  )
}

function QueueClear() {
  const { qClear } = usePlayer()
  return (
    <button id="qClear" title="Clear queue (keeps current)" onClick={qClear}>
      Clear
    </button>
  )
}
