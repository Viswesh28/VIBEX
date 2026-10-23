import { useEffect, useRef, useState } from 'react'
import { hasIndicScript, transliterateToRoman } from '../lib/transliterate.js'
import { Icon } from './Icon.jsx'

/**
 * Shared lyrics renderer for NowPlaying, FullPlayer, and LyricsOverlay.
 * Supports click-to-seek on any synced timestamp, manual scroll pause + resume
 * sync pill, and optional Indic -> Roman sing-along transliteration.
 */
export function LyricsBody({
  res,
  activeIdx,
  className = '',
  onSeekLine = null,
  romanize = false,
}) {
  const boxRef = useRef(null)
  const [userScrolling, setUserScrolling] = useState(false)
  const resumeTimerRef = useRef(null)

  useEffect(() => {
    return () => {
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    }
  }, [])

  const pauseAutoScrollBriefly = () => {
    setUserScrolling(true)
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = setTimeout(() => {
      setUserScrolling(false)
    }, 8000)
  }

  // Keep the current line centred unless the listener manually scrolled to browse ahead.
  useEffect(() => {
    if (userScrolling || !res || res.type !== 'synced' || activeIdx < 0) return
    const el = boxRef.current?.querySelectorAll('.lyr-line')?.[activeIdx]
    try {
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    } catch {
      /* jsdom / older browsers */
    }
  }, [activeIdx, res, userScrolling])

  if (!res)
    return (
      <div className="lyr-state">
        <Icon name="lyrics" size={26} />
        Play a song to see lyrics.
      </div>
    )
  if (res.type === 'loading') return <div className="lyr-state">Loading lyrics…</div>
  if (res.type === 'instrumental')
    return (
      <div className="lyr-state">
        <Icon name="music" size={26} />
        Instrumental track — no lyrics.
      </div>
    )
  if (res.type === 'error')
    return (
      <div className="lyr-state">
        Couldn&apos;t reach the lyrics service.
        <br />
        Check your connection and try again.
      </div>
    )
  if (res.type === 'plain') {
    const showRoman = romanize && hasIndicScript(res.text)
    return (
      <div className="lyr-plain">
        {res.text}
        {showRoman && (
          <div className="lyr-roman-block">{transliterateToRoman(res.text)}</div>
        )}
      </div>
    )
  }
  if (res.type === 'synced')
    return (
      <div
        ref={boxRef}
        className={'lyr-synced-wrap ' + className}
        onWheel={pauseAutoScrollBriefly}
        onTouchMove={pauseAutoScrollBriefly}
      >
        {userScrolling && (
          <button
            type="button"
            className="chip lyr-resume-pill"
            onClick={() => setUserScrolling(false)}
          >
            Resume sync
          </button>
        )}
        {res.lines.map((l, i) => {
          const roman = romanize && hasIndicScript(l.text) ? transliterateToRoman(l.text) : ''
          const seekable = typeof onSeekLine === 'function' && Number.isFinite(l.time)
          return (
            <div
              key={i}
              role={seekable ? 'button' : undefined}
              tabIndex={seekable ? 0 : undefined}
              className={
                'lyr-line' +
                (i === activeIdx ? ' active' : i < activeIdx ? ' past' : '') +
                (seekable ? ' seekable' : '')
              }
              onClick={
                seekable
                  ? () => {
                      setUserScrolling(false)
                      onSeekLine(l.time)
                    }
                  : undefined
              }
              onKeyDown={
                seekable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setUserScrolling(false)
                        onSeekLine(l.time)
                      }
                    }
                  : undefined
              }
            >
              <div>{l.text}</div>
              {roman && <div className="lyr-roman">{roman}</div>}
            </div>
          )
        })}
      </div>
    )
  return <div className="lyr-state">No lyrics found for this song.</div>
}
