import { decodeHtml } from '../lib/format.js'
import { artistsOf, imgOf } from '../lib/song.js'
import { Icon } from './Icon.jsx'
import { LyricsBody } from './LyricsBody.jsx'
import { useLyrics } from '../hooks/useLyrics.js'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useUI } from '../state/UIContext.jsx'

/** Full-screen lyrics, washed in the current artwork. */
export function LyricsOverlay() {
  const { current } = usePlayer()
  const { dataSaver } = useSettings()
  const { lyricsOpen, setLyricsOpen } = useUI()
  const open = lyricsOpen && !!current
  const { res, activeIdx } = useLyrics(current, open)
  const art = current ? imgOf(current, dataSaver) : ''

  return (
    <div id="lyrOverlay" className={open ? 'open' : ''}>
      <div id="lyrBg" style={{ backgroundImage: art ? `url("${art}")` : 'none' }} aria-hidden="true" />
      <div id="lyrOvShade" onClick={() => setLyricsOpen(false)} aria-hidden="true" />
      <div id="lyrSheet" role="dialog" aria-modal="true" aria-label="Lyrics">
        <div id="lyrOvHead">
          <Icon name="lyrics" size={17} />
          <b>Lyrics</b>
          <span id="lyrOvSong">
            {current ? `${decodeHtml(current.name)} · ${decodeHtml(artistsOf(current))}` : ''}
          </span>
          <button
            type="button"
            id="lyrOvClose"
            title="Close (Esc)"
            aria-label="Close lyrics"
            onClick={() => setLyricsOpen(false)}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div id="lyrOvContent">
          <LyricsBody res={open ? res : null} activeIdx={activeIdx} />
        </div>
      </div>
    </div>
  )
}
