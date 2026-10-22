import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { ArtistGrid, CardGrid } from './CardGrid.jsx'
import { SongList } from './SongList.jsx'
import { EmptyState, Spinner } from './Spinner.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { SOURCE_ID, SOURCES, cataloguePath, mapYtResults, sourceOf } from '../lib/sources.js'

const ENDPOINT = {
  songs: (q) => `/search/songs?query=${encodeURIComponent(q)}&limit=20`,
  albums: (q) => `/search/albums?query=${encodeURIComponent(q)}&limit=18`,
  artists: (q) => `/search/artists?query=${encodeURIComponent(q)}&limit=18`,
  playlists: (q) => `/search/playlists?query=${encodeURIComponent(q)}&limit=18`,
}

export function SearchView({ query, tab, onCount }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const { setStatus } = useStatus()
  const { navigate } = useUI()
  const { setQueue } = usePlayer()
  const { source, setSource } = useSettings()

  // YouTube Music can search, but not play: the note below the results says so
  // instead of leaving a listener to discover it by pressing play.
  const yt = source === SOURCE_ID.ytmusic
  // Only the songs tab has a YouTube Music equivalent; the rest stay on Saavn.
  const ytHere = yt && tab === 'songs'

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setStatus(`Searching ${tab} for “${query}”…`)
    api(ytHere ? cataloguePath(SOURCE_ID.ytmusic, query, 20) : ENDPOINT[tab](query))
      .then((d) => {
        if (!alive) return
        const list = ytHere ? mapYtResults(d.results) : d.results || []
        setData(list)
        setLoading(false)
        onCount?.(`(${d.total ?? list.length} found)`)
        if (tab === 'songs') {
          setQueue(list)
          setStatus(list.length ? '' : 'No songs found.')
        } else if (tab === 'albums') setStatus('')
        else if (tab === 'artists') setStatus('')
        else setStatus('')
      })
      .catch((e) => {
        if (!alive) return
        setError(e.message)
        setLoading(false)
        setStatus('Search failed: ' + e.message, true)
      })
    return () => {
      alive = false
    }
  }, [query, tab, setStatus, onCount, setQueue, ytHere])

  if (loading) return <Spinner />
  if (error) return <EmptyState icon="alert" title="Search failed" hint={error} />
  if (!data?.length)
    return <EmptyState icon="search" title={`No ${tab} found`} hint="Try another search." />

  if (tab === 'songs') {
    const chosen = sourceOf(source)
    return (
      <>
        {/* The choice lives where the results are, not buried in Settings —
            switching source is something you want mid-search. */}
        <div className="src-switch" role="group" aria-label="Music source">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={'src-chip' + (s.id === source ? ' on' : '')}
              aria-pressed={s.id === source}
              onClick={() => setSource(s.id)}
            >
              {s.short}
            </button>
          ))}
        </div>
        <p className="set-note src-note">
          {chosen.plays === 'catalogue-only'
            ? chosen.note
            : `Searching ${chosen.label}.`}
        </p>
        <SongList songs={data} />
      </>
    )
  }
  if (tab === 'artists')
    return <ArtistGrid items={data} onOpen={(a) => navigate({ kind: 'artist', id: a.id })} />
  return (
    <CardGrid
      items={data}
      kind={tab === 'albums' ? 'album' : 'playlist'}
      onOpen={(item) =>
        navigate({ kind: 'detail', type: tab === 'albums' ? 'album' : 'playlist', id: item.id })
      }
    />
  )
}
