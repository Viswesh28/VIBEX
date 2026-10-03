import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { CardGrid } from './CardGrid.jsx'
import { EmptyState, Spinner } from './Spinner.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'

const FEED = [
  ['🔥 Tamil Trending', 'tamil trending songs'],
  ['🎬 Bollywood Hits', 'bollywood party hits'],
  ['🌍 Global Charts', 'top global hits'],
  ['🎧 Evergreen Classics', 'evergreen hits tamil'],
]

/** Home: a few curated chart shelves. */
export function FeedView() {
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const { setStatus } = useStatus()
  const { navigate } = useUI()

  useEffect(() => {
    let alive = true
    setLoading(true)
    setStatus('Loading your feed…')
    Promise.all(
      FEED.map(([title, q]) =>
        api(`/search/playlists?query=${encodeURIComponent(q)}&limit=6`)
          .then((d) => ({ title, items: d.results || [] }))
          .catch(() => ({ title, items: [] }))
      )
    ).then((all) => {
      if (!alive) return
      const ok = all.filter((s) => s.items.length)
      setSections(ok)
      setLoading(false)
      if (!ok.length) setStatus('Feed failed to load.', true)
      else setStatus('Home feed — click a playlist, or search above.')
    })
    return () => {
      alive = false
    }
  }, [setStatus])

  if (loading) return <Spinner />
  if (!sections.length)
    return <EmptyState icon="📡" title="Feed unavailable" hint="Search for something above instead." />

  return (
    <>
      {sections.map((sec) => (
        <div className="feed-sec" key={sec.title}>
          <h3>{sec.title}</h3>
          <CardGrid
            items={sec.items}
            kind="playlist"
            onOpen={(item) => navigate({ kind: 'detail', type: 'playlist', id: item.id })}
          />
        </div>
      ))}
    </>
  )
}
