import { useState } from 'react'
import { decodeHtml } from '../lib/format.js'
import { shareOrDownloadLyricCard } from '../lib/lyricCard.js'
import { artistsOf, imgOf } from '../lib/song.js'
import { hasIndicScript } from '../lib/transliterate.js'
import { Icon } from './Icon.jsx'
import { LyricsBody } from './LyricsBody.jsx'
import { useLyrics } from '../hooks/useLyrics.js'
import { usePlayerTransport } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'

function ActiveLyricsPanel({ current, seekTo, setStatus }) {
  const { res, activeIdx } = useLyrics(current, true)
  const [romanize, setRomanize] = useState(false)

  const sampleText =
    res?.type === 'synced'
      ? res.lines.map((l) => l.text).join(' ')
      : res?.type === 'plain'
        ? res.text
        : ''
  const canRomanize = hasIndicScript(sampleText)

  const handleShareCard = async () => {
    const lines =
      res?.type === 'synced' && res.lines.length
        ? res.lines.slice(Math.max(0, activeIdx), Math.max(0, activeIdx) + 3).map((l) => l.text)
        : res?.type === 'plain'
          ? res.text.split('\n').filter(Boolean).slice(0, 3)
          : [decodeHtml(current?.name || '')]
    try {
      const out = await shareOrDownloadLyricCard({ track: current, lines })
      setStatus(
        out.shared
          ? 'Shared lyric poster card.'
          : 'Saved high-resolution lyric poster PNG to Downloads.'
      )
    } catch {
      setStatus('Could not export lyric card right now.', true)
    }
  }

  return (
    <>
      <div className="lyr-tools">
        {canRomanize && (
          <button
            type="button"
            className={'chip' + (romanize ? ' active' : '')}
            aria-pressed={romanize}
            onClick={() => setRomanize((v) => !v)}
          >
            <Icon name="translate" size={14} />
            Romanize
          </button>
        )}
        <button type="button" className="chip" onClick={handleShareCard}>
          <Icon name="card" size={14} />
          Share Lyric Card
        </button>
      </div>
      <LyricsBody
        res={res}
        activeIdx={activeIdx}
        onSeekLine={seekTo}
        romanize={romanize}
      />
    </>
  )
}

/** Full-screen lyrics, washed in the current artwork. Subscribes to clock ONLY while open. */
export function LyricsOverlay() {
  const { current, seekTo } = usePlayerTransport()
  const { dataSaver } = useSettings()
  const { setStatus } = useStatus()
  const { lyricsOpen, setLyricsOpen } = useUI()
  const open = lyricsOpen && !!current
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
          {open ? (
            <ActiveLyricsPanel current={current} seekTo={seekTo} setStatus={setStatus} />
          ) : (
            <LyricsBody res={null} activeIdx={-1} />
          )}
        </div>
      </div>
    </div>
  )
}
