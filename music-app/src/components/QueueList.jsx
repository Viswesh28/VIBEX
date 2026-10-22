import { useEffect, useRef } from 'react'
import { decodeHtml, fmt } from '../lib/format.js'
import { artistsOf, imgOf } from '../lib/song.js'
import { Icon } from './Icon.jsx'
import { RecBadge } from './Provenance.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'

export function QueueList() {
  const { queue, currentIndex, playTrack, qMove, qRemove, dismissRecommendation } = usePlayer()
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
      {queue.map((s, i) => {
        const name = decodeHtml(s.name)
        return (
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
              <div className="q-t">{name}</div>
              <div className="q-a">
                {decodeHtml(artistsOf(s))}
                {s._prov && (
                  <RecBadge prov={s._prov} onDismiss={() => dismissRecommendation(i)} />
                )}
              </div>
            </div>
            <span className="q-acts">
              <button
                type="button"
                title="Move up"
                aria-label={`Move ${name} up the queue`}
                onClick={stop(() => qMove(i, -1))}
              >
                <Icon name="chevronDown" size={14} style={{ transform: 'rotate(180deg)' }} />
              </button>
              <button
                type="button"
                title="Move down"
                aria-label={`Move ${name} down the queue`}
                onClick={stop(() => qMove(i, 1))}
              >
                <Icon name="chevronDown" size={14} />
              </button>
              {s._prov && (
                <button
                  type="button"
                  data-a="dismiss"
                  title="Dismiss this suggestion"
                  aria-label={`Dismiss ${name} and hear fewer like it`}
                  onClick={stop(() => dismissRecommendation(i))}
                >
                  <Icon name="sparkle" size={14} />
                </button>
              )}
              <button
                type="button"
                data-a="rm"
                title="Remove"
                aria-label={`Remove ${name} from the queue`}
                onClick={stop(() => qRemove(i))}
              >
                <Icon name="close" size={14} />
              </button>
            </span>
            <span className="q-d">{fmt(s.duration)}</span>
          </div>
        )
      })}
    </div>
  )
}
