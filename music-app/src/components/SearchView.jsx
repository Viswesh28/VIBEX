import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { createProviderRegistry } from '../lib/providers.js'
import { SOURCE_ID } from '../lib/sources.js'
import { ArtistGrid, CardGrid } from './CardGrid.jsx'
import { SongList } from './SongList.jsx'
import { EmptyState, Spinner } from './Spinner.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'
import { usePlayerTransport } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'

const ENDPOINT = {
  albums: (q) => `/search/albums?query=${encodeURIComponent(q)}&limit=18`,
  artists: (q) => `/search/artists?query=${encodeURIComponent(q)}&limit=18`,
  playlists: (q) => `/search/playlists?query=${encodeURIComponent(q)}&limit=18`,
}

export function SearchView({ query, tab, onCount }) {
  const [data, setData] = useState(null)
  const [nextPageToken, setNextPageToken] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const { setStatus } = useStatus()
  const { navigate } = useUI()
  const { queue, setQueue } = usePlayerTransport()
  const { source } = useSettings()

  // Scoped per view lifecycle so non-sensitive metadata is cached across tab
  // switches and back-navigation without leaking stale state across sessions.
  const registry = useMemo(() => createProviderRegistry({ apiFn: api }), [])

  const yt = source === SOURCE_ID.ytmusic
  const activeCatalogId = yt && tab === 'songs' ? SOURCE_ID.ytmusic : SOURCE_ID.jiosaavn

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setNextPageToken(null)
    setStatus(`Searching ${tab} for “${query}”…`)

    const request =
      tab === 'songs'
        ? registry.getCatalog(activeCatalogId).search(query, { limit: 20 })
        : api(ENDPOINT[tab](query)).then((d) => ({
            songs: d.results || [],
            total: d.total ?? (d.results || []).length,
            nextPageToken: null,
          }))

    request
      .then((d) => {
        if (!alive) return
        const list = d.songs || []
        setData(list)
        setNextPageToken(d.nextPageToken || null)
        setLoading(false)
        onCount?.(`(${d.total ?? list.length} found)`)
        if (tab === 'songs') {
          setQueue(list, { onlyIfIdle: true })
          setStatus(list.length ? '' : 'No songs found.')
        } else {
          setStatus('')
        }
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
  }, [query, tab, setStatus, onCount, setQueue, activeCatalogId, registry])

  const loadMore = useCallback(async () => {
    if (!nextPageToken || loadingMore || tab !== 'songs') return
    setLoadingMore(true)
    try {
      const more = await registry
        .getCatalog(activeCatalogId)
        .search(query, { pageToken: nextPageToken, limit: 20 })
      const prevList = data || []
      const isShowingActiveQueue =
        !queue.length ||
        (queue.length === prevList.length && queue.every((s, idx) => s?.id === prevList[idx]?.id))
      const seen = new Set(prevList.map((s) => s.id))
      const appended = (more.songs || []).filter((s) => s?.id && !seen.has(s.id))
      const combined = [...prevList, ...appended]
      setData(combined)
      setNextPageToken(more.nextPageToken || null)
      if (isShowingActiveQueue) {
        setQueue(combined)
      }
    } catch (e) {
      setStatus('Could not load more results: ' + e.message, true)
    } finally {
      setLoadingMore(false)
    }
  }, [nextPageToken, loadingMore, tab, registry, activeCatalogId, query, data, queue, setQueue, setStatus])

  if (loading) return <Spinner />
  if (error) return <EmptyState icon="alert" title="Search failed" hint={error} />
  if (!data?.length)
    return <EmptyState icon="search" title={`No ${tab} found`} hint="Try another search." />

  // The source switch itself lives in the top bar (see SourceSwitch), so the
  // results do not repeat it; the banner there carries the limit.
  if (tab === 'songs') {
    return (
      <>
        <SongList songs={data} />
        {nextPageToken && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
            <button
              type="button"
              className="btn-ghost"
              disabled={loadingMore}
              onClick={loadMore}
            >
              {loadingMore ? 'Loading more…' : 'Load more tracks'}
            </button>
          </div>
        )}
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
