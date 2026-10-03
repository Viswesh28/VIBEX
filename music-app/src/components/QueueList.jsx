import { useEffect, useRef } from 'react'
import { decodeHtml, fmt } from '../lib/format.js'
import { artistsOf, imgOf } from '../lib/song.js'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'

export function QueueList() {
  const { queue, currentIndex, playTrack, qMove, qRemove } = usePlayer()
  const { dataSaver } = useSettings()
  const activeRef = useRef(null)

  useEffect(() => {
    try {
      activeRef.current?.scrollIntoView({ block: 'nearest' })
    } catch {
      /* ignore */
    }
  }, [currentIndex])

  if (!queue.length)
    return (
      <div id="queueList">
        <div className="q-empty">
          Queue is empty.
          <br />
          Search and play something.
        </div>
      </div>
    )

  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn()
  }

  return (
    <div id="queueList">
      {queue.map((s, i) => (
        <div
          key={`${s.id}-${i}`}
          ref={i === currentIndex ? activeRef : null}
          className={'q-row' + (i === currentIndex ? ' playing' : '')}
          onClick={() => playTrack(i)}
        >
          <span className="q-num">{i + 1}</span>
          <img
            src={imgOf(s, dataSaver)}
            loading="lazy"
            alt=""
            onError={(e) => {
              e.currentTarget.style.opacity = 0.25
            }}
          />
          <div className="q-info">
            <div className="q-t">{decodeHtml(s.name)}</div>
            <div className="q-a">{decodeHtml(artistsOf(s))}</div>
          </div>
          <span className="q-acts">
            <button title="Move up" onClick={stop(() => qMove(i, -1))}>
              ▲
            </button>
            <button title="Move down" onClick={stop(() => qMove(i, 1))}>
              ▼
            </button>
            <button title="Remove" onClick={stop(() => qRemove(i))}>
              ✕
            </button>
          </span>
          <span className="q-d">{fmt(s.duration)}</span>
        </div>
      ))}
    </div>
  )
}
