import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { createProviderRegistry } from '../lib/providers.js'
import { SOURCE_ID } from '../lib/sources.js'
import { ArtistGrid, CardGrid } from './CardGrid.jsx'
import { SongList } from './SongList.jsx'
import { EmptyState, SectionTitle, Spinner } from './Spinner.jsx'
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
  const [unified, setUnified] = useState(null)
  const [nextPageToken, setNextPageToken] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const { setStatus } = useStatus()
  const { navigate } = useUI()
  const { queue, setQueue } = usePlayerTransport()
  const { source } = useSettings()

  const registry = useMemo(() => createProviderRegistry({ apiFn: api }), [])

  const yt = source === SOURCE_ID.ytmusic
  const activeCatalogId = yt && (tab === 'songs' || tab === 'all') ? SOURCE_ID.ytmusic : SOURCE_ID.jiosaavn

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setNextPageToken(null)
    setStatus(`Searching ${tab} for “${query}”…`)

    if (tab === 'all') {
      Promise.allSettled([
        registry.getCatalog(activeCatalogId).search(query, { limit: 8 }),
        api(ENDPOINT.artists(query)),
        api(ENDPOINT.albums(query)),
        api(ENDPOINT.playlists(query)),
      ]).then(([songsRes, artistsRes, albumsRes, playlistsRes]) => {
        if (!alive) return
        const songs = songsRes.status === 'fulfilled' ? songsRes.value.songs || [] : []
        const artists = artistsRes.status === 'fulfilled' ? (artistsRes.value.results || []).slice(0, 6) : []
        const albums = albumsRes.status === 'fulfilled' ? (albumsRes.value.results || []).slice(0, 6) : []
        const playlists = playlistsRes.status === 'fulfilled' ? (playlistsRes.value.results || []).slice(0, 6) : []
        const total = songs.length + artists.length + albums.length + playlists.length
        setUnified({ songs, artists, albums, playlists })
        setData(songs)
        setLoading(false)
        onCount?.(`(${total} top results)`)
        if (songs.length) setQueue(songs, { onlyIfIdle: true })
        setStatus('')
      })
      return () => {
        alive = false
      }
    }

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

  if (tab === 'all') {
    const hasAny =
      unified &&
      (unified.songs.length || unified.artists.length || unified.albums.length || unified.playlists.length)
    if (!hasAny) return <EmptyState icon="search" title="No results found" hint="Try another search." />
    return (
      <>
        {unified.songs.length > 0 && (
          <>
            <SectionTitle>
              Top songs <span>{unified.songs.length}</span>
            </SectionTitle>
            <SongList songs={unified.songs} />
          </>
        )}
        {unified.artists.length > 0 && (
          <>
            <SectionTitle>
              Artists <span>{unified.artists.length}</span>
            </SectionTitle>
            <ArtistGrid
              items={unified.artists}
              onOpen={(a) => navigate({ kind: 'artist', id: a.id })}
            />
          </>
        )}
        {unified.albums.length > 0 && (
          <>
            <SectionTitle>
              Albums <span>{unified.albums.length}</span>
            </SectionTitle>
            <CardGrid
              items={unified.albums}
              kind="album"
              onOpen={(item) => navigate({ kind: 'detail', type: 'album', id: item.id })}
            />
          </>
        )}
        {unified.playlists.length > 0 && (
          <>
            <SectionTitle>
              Playlists <span>{unified.playlists.length}</span>
            </SectionTitle>
            <CardGrid
              items={unified.playlists}
              kind="playlist"
              onOpen={(item) => navigate({ kind: 'detail', type: 'playlist', id: item.id })}
            />
          </>
        )}
      </>
    )
  }

  if (!data?.length)
    return <EmptyState icon="search" title={`No ${tab} found`} hint="Try another search." />

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
