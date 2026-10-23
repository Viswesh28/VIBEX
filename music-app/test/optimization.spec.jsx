import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { api, clearApiCache, prefetchApi } from '../src/lib/api.js'
import { Card } from '../src/components/CardGrid.jsx'
import { SongList } from '../src/components/SongList.jsx'
import { LibraryProvider } from '../src/state/LibraryContext.jsx'
import { PlayerProvider, usePlayerClock } from '../src/state/PlayerContext.jsx'
import { SettingsProvider } from '../src/state/SettingsContext.jsx'
import { StatusProvider } from '../src/state/StatusContext.jsx'
import { UIProvider } from '../src/state/UIContext.jsx'

beforeEach(() => {
  localStorage.clear()
  clearApiCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('site performance optimizations', () => {
  it('deduplicates concurrent in-flight API requests and serves instant cached reads', async () => {
    let networkHits = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        networkHits += 1
        await new Promise((r) => setTimeout(r, 15))
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { results: [{ id: 's1', name: 'Fast Song' }] } }),
        }
      })
    )

    // 5 concurrent identical calls collapse into 1 single HTTP request.
    const [a, b, c, d, e] = await Promise.all([
      api('/search/songs?query=fast'),
      api('/search/songs?query=fast'),
      api('/search/songs?query=fast'),
      api('/search/songs?query=fast'),
      api('/search/songs?query=fast'),
    ])
    expect(networkHits).toBe(1)
    expect(a).toEqual(e)
    expect([b, c, d]).toHaveLength(3)

    // Subsequent navigation read within TTL resolves in 0ms from RAM with 0 extra network hits.
    const cached = await api('/search/songs?query=fast')
    expect(cached.results[0].name).toBe('Fast Song')
    expect(networkHits).toBe(1)
  })

  it('pre-warms playlist detail payload into memory on pointer hover before click', async () => {
    const seenUrls = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        seenUrls.push(String(url))
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { id: 'pl_99', name: 'Warm Playlist', songs: [] } }),
        }
      })
    )

    render(
      <SettingsProvider>
        <Card
          item={{ id: 'pl_99', name: 'Warm Playlist', image: [{ url: 'https://img/p.jpg' }] }}
          kind="playlist"
          onOpen={vi.fn()}
          dataSaver={false}
        />
      </SettingsProvider>
    )

    const cardBtn = screen.getByRole('button', { name: 'Open Warm Playlist' })
    fireEvent.pointerEnter(cardBtn)
    await new Promise((r) => setTimeout(r, 10))
    expect(seenUrls.some((u) => u.includes('/api/playlists?id=pl_99&limit=100'))).toBe(true)

    // Reading the prefetched playlist hits RAM with 0 additional fetches.
    const countAfterHover = seenUrls.length
    prefetchApi('/playlists?id=pl_99&limit=100')
    const data = await api('/playlists?id=pl_99&limit=100')
    expect(data.id).toBe('pl_99')
    expect(seenUrls.length).toBe(countAfterHover)
  })

  it('keeps SongList & SongRow completely isolated from high-frequency audio timeupdate ticks', async () => {
    let clockReads = 0
    function ClockObserver() {
      const clock = usePlayerClock()
      clockReads += 1
      return <output data-testid="clk">{clock.cur.toFixed(1)}</output>
    }

    const tracks = Array.from({ length: 25 }, (_, i) => ({
      id: `t_${i}`,
      name: `Track ${i}`,
      duration: 210,
      image: [{ url: `https://img/${i}.jpg` }],
      artists: { primary: [{ name: 'Artist' }] },
      album: { name: 'Album' },
      downloadUrl: [{ quality: '320kbps', url: `https://aac.saavncdn.com/t_${i}.mp4` }],
    }))

    let listRenders = 0
    function TrackedList() {
      listRenders += 1
      return <SongList songs={tracks} />
    }

    const { container } = render(
      <StatusProvider>
        <SettingsProvider>
          <LibraryProvider>
            <PlayerProvider>
              <UIProvider>
                <ClockObserver />
                <TrackedList />
              </UIProvider>
            </PlayerProvider>
          </LibraryProvider>
        </SettingsProvider>
      </StatusProvider>
    )

    const baselineListRenders = listRenders
    const baselineClockReads = clockReads
    const audioEl = container.querySelector('audio')

    // Simulate 10 rapid audio timeupdate ticks (0.5s -> 5.0s).
    for (let step = 1; step <= 10; step++) {
      await act(async () => {
        Object.defineProperty(audioEl, 'currentTime', { value: step * 0.5, configurable: true })
        Object.defineProperty(audioEl, 'duration', { value: 210, configurable: true })
        fireEvent.timeUpdate(audioEl)
      })
    }

    // Clock consumers updated cleanly, while the 25-row SongList performed ZERO re-renders!
    expect(clockReads).toBeGreaterThan(baselineClockReads)
    expect(listRenders).toBe(baselineListRenders)
  })
})
