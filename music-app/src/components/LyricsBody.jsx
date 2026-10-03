import { useEffect, useRef } from 'react'

/** Shared lyrics renderer for the side panel and the full-screen overlay. */
export function LyricsBody({ res, activeIdx, className = '' }) {
  const boxRef = useRef(null)

  // Keep the current line centred as playback advances.
  useEffect(() => {
    if (!res || res.type !== 'synced' || activeIdx < 0) return
    const el = boxRef.current?.children[activeIdx]
    try {
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    } catch {
      /* jsdom / older browsers */
    }
  }, [activeIdx, res])

  if (!res) return <div className="lyr-state">Play a song to see lyrics.</div>
  if (res.type === 'loading') return <div className="lyr-state">Loading lyrics…</div>
  if (res.type === 'instrumental')
    return (
      <div className="lyr-state">
        🎹
        <br />
        Instrumental track — no lyrics.
      </div>
    )
  if (res.type === 'error')
    return (
      <div className="lyr-state">
        Couldn&apos;t reach lyrics service.
        <br />
        Check connection and retry.
      </div>
    )
  if (res.type === 'plain') return <div className="lyr-plain">{res.text}</div>
  if (res.type === 'synced')
    return (
      <div ref={boxRef} className={className}>
        {res.lines.map((l, i) => (
          <div
            key={i}
            className={'lyr-line' + (i === activeIdx ? ' active' : i < activeIdx ? ' past' : '')}
          >
            {l.text}
          </div>
        ))}
      </div>
    )
  return (
    <div className="lyr-state">
      No lyrics found
      <br />
      for this song.
    </div>
  )
}
