import { useEffect, useRef, useState } from 'react'
import { activeLineIndex, fetchLyrics } from '../lib/lrc.js'
import { usePlayer } from '../state/PlayerContext.jsx'

/**
 * Loads lyrics for `song` and tracks which line is current.
 * Returns { res, activeIdx } where res.type is synced|plain|instrumental|none|error.
 */
export function useLyrics(song, enabled) {
  const { clock } = usePlayer()
  const [res, setRes] = useState(null)
  const [activeIdx, setActiveIdx] = useState(-1)
  const reqId = useRef(0)

  useEffect(() => {
    if (!enabled || !song) {
      setRes(null)
      setActiveIdx(-1)
      return
    }
    const id = ++reqId.current
    setRes({ type: 'loading' })
    setActiveIdx(-1)
    fetchLyrics(song).then((r) => {
      // Ignore a response that arrived after the user moved on.
      if (reqId.current === id) setRes(r)
    })
  }, [song, enabled])

  useEffect(() => {
    if (!res || res.type !== 'synced') return
    const idx = activeLineIndex(res.lines, clock.cur)
    setActiveIdx((prev) => (prev === idx ? prev : idx))
  }, [clock.cur, res])

  return { res, activeIdx }
}
