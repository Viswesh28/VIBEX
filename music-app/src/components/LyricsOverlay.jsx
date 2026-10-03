import { decodeHtml } from '../lib/format.js'
import { artistsOf } from '../lib/song.js'
import { LyricsBody } from './LyricsBody.jsx'
import { useLyrics } from '../hooks/useLyrics.js'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useUI } from '../state/UIContext.jsx'

export function LyricsOverlay() {
  const { current } = usePlayer()
  const { lyricsOpen, setLyricsOpen } = useUI()
  const open = lyricsOpen && !!current
  const { res, activeIdx } = useLyrics(current, open)

  return (
    <div id="lyrOverlay" className={open ? 'open' : ''}>
      <div id="lyrOvShade" onClick={() => setLyricsOpen(false)} />
      <div id="lyrSheet">
        <div id="lyrOvHead">
          <b>🎤 Lyrics</b>
          <span id="lyrOvSong">
            {current ? `${decodeHtml(current.name)} • ${decodeHtml(artistsOf(current))}` : ''}
          </span>
          <button id="lyrOvClose" title="Close (Esc)" onClick={() => setLyricsOpen(false)}>
            ✕
          </button>
        </div>
        <div id="lyrOvContent">
          <LyricsBody res={open ? res : null} activeIdx={activeIdx} />
        </div>
      </div>
    </div>
  )
}
