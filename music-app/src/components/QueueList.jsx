import { memo, useEffect, useRef, useState } from 'react'
import { decodeHtml, fmt } from '../lib/format.js'
import { artistsOf, imgOf } from '../lib/song.js'
import { Icon } from './Icon.jsx'
import { RecBadge } from './Provenance.jsx'
import { useLibrary } from '../state/LibraryContext.jsx'
import { usePlayerTransport } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'

export const QueueList = memo(function QueueList({ showTabs = true }) {
  const {
    queue,
    currentIndex,
    recentHistory = [],
    playTrack,
    playFromList,
    qMove,
    qReorder,
    qRemove,
    dismissRecommendation,
  } = usePlayerTransport()
  const { saveSongsAsPlaylist } = useLibrary()
  const { dataSaver } = useSettings()
  const { setStatus } = useStatus()
  const { navigate } = useUI()

  const [mode, setMode] = useState('queue')
  const [dragIdx, setDragIdx] = useState(null)
  const activeRef = useRef(null)

  useEffect(() => {
    try {
      activeRef.current?.scrollIntoView({ block: 'nearest' })
    } catch {
      /* ignore */
    }
  }, [currentIndex])

  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn()
  }

  const handleSaveQueue = () => {
    if (!queue.length) return
    const title = `Queue Mix · ${new Date().toLocaleDateString('en-IN', {
      month: 'short',
      day: 'numeric',
    })}`
    const plId = saveSongsAsPlaylist(title, queue)
    setStatus(`Saved ${queue.length} queued songs as “${title}”.`)
    navigate({ kind: 'myplaylist', id: plId })
  }

  return (
    <div id="queueList">
      {showTabs && (
        <div className="q-toolbar">
          <div className="q-mode-pills">
            <button
              type="button"
              className={'chip' + (mode === 'queue' ? ' active' : '')}
              onClick={() => setMode('queue')}
            >
              Up Next {queue.length ? `(${queue.length})` : ''}
            </button>
            <button
              type="button"
              className={'chip' + (mode === 'recent' ? ' active' : '')}
              onClick={() => setMode('recent')}
            >
              Recent {recentHistory.length ? `(${recentHistory.length})` : ''}
            </button>
          </div>
          {mode === 'queue' && queue.length > 0 && (
            <button
              type="button"
              className="btn-ghost q-save-btn"
              title="Save current queue as a playlist"
              aria-label="Save queue as playlist"
              onClick={handleSaveQueue}
            >
              <Icon name="plus" size={13} /> Save
            </button>
          )}
        </div>
      )}

      {mode === 'recent' ? (
        !recentHistory.length ? (
          <div className="q-empty">
            No recent songs yet.
            <br />
            Tracks you play appear here automatically.
          </div>
        ) : (
          recentHistory.map((s, i) => {
            const name = decodeHtml(s.name)
            return (
              <div
                key={`recent-${s.id}-${i}`}
                className="q-row"
                onClick={() => playFromList(recentHistory, i)}
              >
                <span className="q-num">{i + 1}</span>
                <img
                  src={imgOf(s, dataSaver)}
                  loading="lazy"
                  decoding="async"
                  alt=""
                  onError={(e) => {
                    e.currentTarget.style.opacity = 0.25
                  }}
                />
                <div className="q-info">
                  <div className="q-t">{name}</div>
                  <div className="q-a">{decodeHtml(artistsOf(s))}</div>
                </div>
                <span className="q-d">{fmt(s.duration)}</span>
              </div>
            )
          })
        )
      ) : !queue.length ? (
        <div className="q-empty">
          Queue is empty.
          <br />
          Search and play something.
        </div>
      ) : (
        queue.map((s, i) => {
          const name = decodeHtml(s.name)
          return (
            <div
              key={`${s.id}-${i}`}
              ref={i === currentIndex ? activeRef : null}
              draggable={Boolean(qReorder)}
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIdx !== null && dragIdx !== i) qReorder?.(dragIdx, i)
                setDragIdx(null)
              }}
              onDragEnd={() => setDragIdx(null)}
              className={
                'q-row' +
                (i === currentIndex ? ' playing' : '') +
                (dragIdx === i ? ' dragging' : '')
              }
              onClick={() => playTrack(i)}
            >
              <span className="q-num">{i + 1}</span>
              <img
                src={imgOf(s, dataSaver)}
                loading="lazy"
                decoding="async"
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
        })
      )}
    </div>
  )
})
