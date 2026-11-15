import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { decodeHtml } from '../lib/format.js'
import { imgOf } from '../lib/song.js'
import { EVENTS, track } from '../lib/telemetry.js'
import { Shelf } from './CardGrid.jsx'
import { Icon } from './Icon.jsx'
import { EmptyState } from './Spinner.jsx'
import { usePlayerTransport } from '../state/PlayerContext.jsx'
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
export const LIVE_FEED_REFRESH_MS = 5 * 60 * 1000
const VISIBILITY_REFRESH_MS = 3 * 60 * 1000

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

const backoffMs = (attempt) => Math.min(4000, 350 * 2 ** attempt + Math.random() * 250)

export function FeedView() {
  const [sections, setSections] = useState([])
  const [liveSongShelves, setLiveSongShelves] = useState([])
  const [loading, setLoading] = useState(true)
  const [degraded, setDegraded] = useState([])
  const [attempt, setAttempt] = useState(0)
  const alive = useRef(true)
  const retryTimer = useRef(null)
  const lastFetchedAt = useRef(0)

  const player = usePlayerTransport()
  const { setStatus } = useStatus()
  const { navigate, search, setImportModalOpen } = useUI()
  const { dataSaver, languages, availableLanguages, toggleLanguage } = useSettings()

  const langParam = (languages && languages.length
    ? languages
    : ['tamil', 'hindi', 'english', 'telugu', 'malayalam']
  ).join(',')

  useEffect(
    () => () => {
      alive.current = false
      if (retryTimer.current) clearTimeout(retryTimer.current)
    },
    []
  )

  const refreshLiveSongs = useCallback(
    (bypassCache = false) => {
      const liveEndpoints = [
        ['New Releases', `/content/new-releases?languages=${encodeURIComponent(langParam)}&limit=12`],
        ['Trending Songs', `/content/trending?languages=${encodeURIComponent(langParam)}&limit=12`],
      ]
      Promise.allSettled(
        liveEndpoints.map(([title, endpoint]) =>
          api(endpoint, { bypassCache }).then((d) => ({
            title,
            items: (d?.results || []).filter((s) => s && s.id && s.downloadUrl?.length),
          }))
        )
      ).then((settled) => {
        if (!alive.current) return
        const fresh = settled
          .filter((r) => r.status === 'fulfilled' && r.value.items.length > 0)
          .map((r) => r.value)
        if (fresh.length) {
          setLiveSongShelves(fresh)
          lastFetchedAt.current = Date.now()
        }
      })
    },
    [langParam]
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
      lastFetchedAt.current = Date.now()
      track(EVENTS.homeLoaded, { sections: ok.length, degraded: dropped.length })
      refreshLiveSongs()
    })
  }, [attempt, refreshLiveSongs, setStatus])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!sections.length) return undefined
    const interval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        refreshLiveSongs(true)
      }
    }, LIVE_FEED_REFRESH_MS)

    const onVisibility = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        Date.now() - lastFetchedAt.current >= VISIBILITY_REFRESH_MS
      ) {
        refreshLiveSongs(true)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [sections.length, refreshLiveSongs])

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
  const playLiveSong = (shelf, item) => {
    const idx = Math.max(0, shelf.items.findIndex((s) => s.id === item.id))
    player?.playFromList(shelf.items, idx)
  }
  const recentHistory = player?.recentHistory || []

  return (
    <>
      <div className="lang-bar" role="group" aria-label="Preferred music languages">
        {(availableLanguages || []).map((lang) => {
          const on = (languages || []).includes(lang.id)
          return (
            <button
              key={lang.id}
              type="button"
              className={'chip' + (on ? ' active' : '')}
              aria-pressed={on}
              onClick={() => toggleLanguage(lang.id)}
            >
              {lang.label}
            </button>
          )
        })}
        <button
          type="button"
          className="chip lang-import-btn"
          onClick={() => setImportModalOpen(true)}
        >
          <Icon name="import" size={13} /> Import playlist
        </button>
      </div>

      <section className="hero feature" aria-labelledby="featureTitle">
        <div
          className="hero-wash"
          aria-hidden="true"
          style={{ backgroundImage: `url("${imgOf(featured, dataSaver)}")` }}
        />
        <div className="hero-scrim" aria-hidden="true" />
        <img
          className="hero-cover"
          src={imgOf(featured, dataSaver)}
          fetchpriority="high"
          decoding="async"
          alt=""
        />
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

      {recentHistory.length > 0 && (
        <Shelf
          title="Jump Back In"
          items={recentHistory.slice(0, 12)}
          kind="song"
          moreLabel="Play all"
          onOpen={(song) => {
            const idx = Math.max(0, recentHistory.findIndex((s) => s.id === song.id))
            player?.playFromList(recentHistory, idx)
          }}
          onMore={() => player?.playFromList(recentHistory, 0)}
        />
      )}

      {liveSongShelves.map((shelf) => (
        <Shelf
          key={shelf.title}
          title={shelf.title}
          items={shelf.items}
          kind="song"
          moreLabel="Play all"
          onOpen={(song) => playLiveSong(shelf, song)}
          onMore={() => player?.playFromList(shelf.items, 0)}
        />
      ))}

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
