import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { decodeHtml } from '../lib/format.js'
import { imgOf } from '../lib/song.js'
import { EVENTS, track } from '../lib/telemetry.js'
import { Shelf } from './CardGrid.jsx'
import { Icon } from './Icon.jsx'
import { EmptyState } from './Spinner.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'

const FEED = [
  ['Tamil Trending', 'tamil trending songs'],
  ['Bollywood Hits', 'bollywood party hits'],
  ['Global Charts', 'top global hits'],
  ['Evergreen Classics', 'evergreen hits tamil'],
]

const SKELETON_CARDS = 6
const MAX_RETRIES = 2

/** Fixed-height placeholders: the home screen must not reflow when data lands. */
function ShelfSkeleton({ title }) {
  return (
    <section className="shelf feed-sec skeleton-shelf" aria-hidden="true">
      <div className="shelf-head">
        <h3 className="shelf-title">{title}</h3>
      </div>
      <div className="shelf-row">
        {Array.from({ length: SKELETON_CARDS }).map((_, i) => (
          <div className="card skeleton" key={i}>
            <span className="card-media sk-media" />
            <span className="meta">
              <span className="sk-line" />
              <span className="sk-line short" />
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

/** Jittered, capped backoff — a herd of clients must not retry in lockstep. */
const backoffMs = (attempt) => Math.min(4000, 350 * 2 ** attempt + Math.random() * 250)

/**
 * Listen Now — the editorial home.
 *
 * The contract mirrors what the shipped players do and what this build needs:
 * every shelf loads independently, a failed shelf is dropped rather than
 * blanking the page, the first-page failure gets a bounded retry with jitter,
 * and every degrade is reported. Silent degradation is invisible without an
 * event, which is the whole reason `home.degraded` exists.
 */
export function FeedView() {
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [degraded, setDegraded] = useState([])
  const [attempt, setAttempt] = useState(0)
  const alive = useRef(true)
  const retryTimer = useRef(null)
  const { setStatus } = useStatus()
  const { navigate, search } = useUI()
  const { dataSaver } = useSettings()

  useEffect(
    () => () => {
      alive.current = false
      if (retryTimer.current) clearTimeout(retryTimer.current)
    },
    []
  )

  const load = useCallback(() => {
    alive.current = true
    setLoading(true)
    setStatus('Loading your feed…')
    Promise.allSettled(
      FEED.map(([title, q]) =>
        api(`/search/playlists?query=${encodeURIComponent(q)}&limit=6`).then((d) => ({
          title,
          query: q,
          items: d.results || [],
        }))
      )
    ).then((results) => {
      if (!alive.current) return
      const ok = []
      const dropped = []
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value.items.length) ok.push(r.value)
        else dropped.push(FEED[i][0])
      })
      if (dropped.length) {
        track(EVENTS.homeDegraded, { sections: dropped, attempt })
        setStatus(`Some shelves didn't load (${dropped.length}). Showing the rest.`, true)
      } else {
        setStatus('')
      }
      setDegraded(dropped)

      if (!ok.length) {
        // Nothing rendered: only now is a retry worth the user's time.
        setLoading(false)
        track(EVENTS.homeFailed, { attempt })
        if (attempt < MAX_RETRIES) {
          retryTimer.current = setTimeout(() => {
            setAttempt((a) => a + 1)
          }, backoffMs(attempt))
        }
        return
      }
      setSections(ok)
      setLoading(false)
      track(EVENTS.homeLoaded, { sections: ok.length, degraded: dropped.length })
    })
  }, [attempt, setStatus])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <>
        <div className="hero skeleton-hero" aria-hidden="true" />
        {FEED.slice(0, 3).map(([title]) => (
          <ShelfSkeleton key={title} title={title} />
        ))}
      </>
    )
  }

  if (!sections.length)
    return (
      <EmptyState
        icon="radio"
        title="Feed unavailable"
        hint={
          attempt < MAX_RETRIES
            ? 'Retrying… you can also search above.'
            : 'The home feed could not be loaded. Search for something above, or try again.'
        }
        action={
          <button type="button" className="btn-ghost retry-btn" onClick={() => setAttempt((a) => a + 1)}>
            Retry
          </button>
        }
      />
    )

  const featured = sections[0].items[0]
  const openPlaylist = (item) => navigate({ kind: 'detail', type: 'playlist', id: item.id })
  const moreIn = (section) => search(section.query, 'playlists')

  return (
    <>
      <section className="hero feature" aria-labelledby="featureTitle">
        <div
          className="hero-wash"
          aria-hidden="true"
          style={{ backgroundImage: `url("${imgOf(featured, dataSaver)}")` }}
        />
        <div className="hero-scrim" aria-hidden="true" />
        <img className="hero-cover" src={imgOf(featured, dataSaver)} alt="" />
        <div className="hero-body">
          <span className="eyebrow">
            <span className="dot" aria-hidden="true" />
            Featured playlist
          </span>
          <h3 id="featureTitle">{decodeHtml(featured.name)}</h3>
          <div className="hero-meta">
            {[featured.songCount ? `${featured.songCount} songs` : '', featured.language]
              .filter(Boolean)
              .map((part, i) => (
                <span key={part}>
                  {i > 0 && <span className="sep"> · </span>}
                  {part}
                </span>
              ))}
          </div>
          <div className="hero-actions">
            <button type="button" className="btn-primary" onClick={() => openPlaylist(featured)}>
              <Icon name="play" size={15} />
              Listen
            </button>
            <button
              type="button"
              className="btn-ghost on-art"
              onClick={() => search(sections[0].query, 'playlists')}
            >
              More in {sections[0].title}
            </button>
          </div>
        </div>
      </section>

      {degraded.length > 0 && (
        <div className="degrade-note" role="status">
          <Icon name="alert" size={15} />
          <span>
            {degraded.length === 1
              ? `“${degraded[0]}” didn't load.`
              : `${degraded.length} shelves didn't load.`}{' '}
            Everything else is up to date.
          </span>
          <button type="button" className="btn-ghost tiny" onClick={() => setAttempt((a) => a + 1)}>
            Reload feed
          </button>
        </div>
      )}

      {sections.map((sec) => (
        <Shelf
          key={sec.title}
          title={sec.title}
          items={sec.items}
          kind="playlist"
          onOpen={openPlaylist}
          onMore={() => moreIn(sec)}
        />
      ))}
    </>
  )
}
