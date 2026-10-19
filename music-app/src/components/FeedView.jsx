import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { decodeHtml } from '../lib/format.js'
import { imgOf } from '../lib/song.js'
import { Shelf } from './CardGrid.jsx'
import { Icon } from './Icon.jsx'
import { EmptyState, Spinner } from './Spinner.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'

const FEED = [
  ['Tamil Trending', 'tamil trending songs'],
  ['Bollywood Hits', 'bollywood party hits'],
  ['Global Charts', 'top global hits'],
  ['Evergreen Classics', 'evergreen hits tamil'],
]

/**
 * Listen Now — the editorial home.
 *
 * A featured playlist leads, then each section is a horizontal shelf. The
 * shelves are the same data the app always fetched; what changed is the
 * hierarchy: one big editorial pick, then depth you can swipe sideways
 * instead of an unbroken wall of tiles.
 */
export function FeedView() {
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const { setStatus } = useStatus()
  const { navigate, search } = useUI()
  const { dataSaver } = useSettings()

  useEffect(() => {
    let alive = true
    setLoading(true)
    setStatus('Loading your feed…')
    Promise.all(
      FEED.map(([title, q]) =>
        api(`/search/playlists?query=${encodeURIComponent(q)}&limit=6`)
          .then((d) => ({ title, query: q, items: d.results || [] }))
          .catch(() => ({ title, query: q, items: [] }))
      )
    ).then((all) => {
      if (!alive) return
      const ok = all.filter((s) => s.items.length)
      setSections(ok)
      setLoading(false)
      if (!ok.length) setStatus('Feed failed to load.', true)
      else setStatus('')
    })
    return () => {
      alive = false
    }
  }, [setStatus])

  if (loading) return <Spinner />
  if (!sections.length)
    return <EmptyState icon="radio" title="Feed unavailable" hint="Search for something above instead." />

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
