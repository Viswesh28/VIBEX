import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { ArtistGrid, CardGrid } from './CardGrid.jsx'
import { SongList } from './SongList.jsx'
import { EmptyState, Spinner } from './Spinner.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'

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

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setStatus(`Searching ${tab} for "${query}"…`)
    api(ENDPOINT[tab](query))
      .then((d) => {
        if (!alive) return
        const list = d.results || []
        setData(list)
        setLoading(false)
        onCount?.(`(${d.total ?? list.length} found)`)
        if (tab === 'songs') {
          setQueue(list)
          setStatus(list.length ? `Found ${list.length} songs. Click to play.` : 'No songs found.')
        } else if (tab === 'albums') setStatus('Click an album to see its songs.')
        else if (tab === 'artists') setStatus('Click an artist to open their page.')
        else setStatus('Click a playlist to see its songs.')
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
  }, [query, tab, setStatus, onCount, setQueue])

  if (loading) return <Spinner />
  if (error) return <EmptyState icon="⚠️" title="Search failed" hint={error} />
  if (!data?.length) return <EmptyState icon="🔍" title={`No ${tab} found`} hint="Try another search." />

  if (tab === 'songs') return <SongList songs={data} />
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
