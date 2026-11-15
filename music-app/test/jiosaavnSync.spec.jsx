import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import upstreamManifest from '../../jiosaavn-api/upstream.json'
import app from '../../jiosaavn-api/src/server.js'
import { FeedView, LIVE_FEED_REFRESH_MS } from '../src/components/FeedView.jsx'
import { SettingsProvider } from '../src/state/SettingsContext.jsx'
import { StatusProvider } from '../src/state/StatusContext.jsx'
import { UIProvider } from '../src/state/UIContext.jsx'
import { fixtures } from './fixtures/api.js'

const ENCRYPTED_MEDIA_URL = 'ID2ieOjCrwfgWvL5sXl4B1ImC5QfbsDyQd+aqn5Yzr3aGttEjbIm9m+XHLUinhCK'

function makeUpstreamSong({ id, title, releaseDate, playCount = '50000', language = 'tamil' }) {
  return {
    id,
    title,
    type: 'song',
    year: releaseDate ? releaseDate.slice(0, 4) : '2026',
    language,
    play_count: String(playCount),
    explicit_content: '0',
    perma_url: `https://www.jiosaavn.com/song/${id}`,
    image: `https://c.saavncdn.com/123/${id}-150x150.jpg`,
    more_info: {
      duration: '215',
      has_lyrics: 'false',
      album: `${title} - Single`,
      album_id: `al_${id}`,
      album_url: `https://www.jiosaavn.com/album/${id}`,
      label: 'Sony Music',
      release_date: releaseDate,
      encrypted_media_url: ENCRYPTED_MEDIA_URL,
      artistMap: {
        primary_artists: [{ id: 'ar1', name: 'Anirudh Ravichander', role: 'singer', image: '', type: 'artist', perma_url: '' }],
        featured_artists: [],
        artists: [{ id: 'ar1', name: 'Anirudh Ravichander', role: 'singer', image: '', type: 'artist', perma_url: '' }],
      },
    },
  }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('sumitkolhe/jiosaavn-api sync, live catalog feeds, and stability fixes', () => {
  it('tracks the synced upstream sumitkolhe/jiosaavn-api repository metadata and exposes /api/content/sync-status', async () => {
    expect(upstreamManifest.repository).toBe('https://github.com/sumitkolhe/jiosaavn-api.git')
    expect(upstreamManifest.branch).toBe('main')
    expect(upstreamManifest.commit).toMatch(/^[0-9a-f]{40}$/)

    const res = await app.request('http://localhost/api/content/sync-status')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('max-age=180')
    expect(res.headers.get('cache-control')).toContain('stale-if-error=604800')
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.upstream.commit).toBe(upstreamManifest.commit)
  })

  it('serves live newly released playable songs sorted newest-first via /api/content/new-releases with Cookie language scoping', async () => {
    const seenCookies = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      seenCookies.push(init?.headers?.Cookie || '')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          new_albums: [
            makeUpstreamSong({ id: 'older_cut', title: 'Last Month Cut', releaseDate: '2026-09-10', playCount: 900000 }),
            { id: 'album_only', title: 'Unplayable Album Entry', type: 'album' },
            makeUpstreamSong({ id: 'brand_new_drop', title: 'Today Fresh Drop', releaseDate: '2026-10-23', playCount: 4200 }),
            makeUpstreamSong({ id: 'last_week', title: 'Last Week Single', releaseDate: '2026-10-16', playCount: 45000 }),
            makeUpstreamSong({ id: 'oct_12', title: 'Oct Twelve Track', releaseDate: '2026-10-12', playCount: 51000 }),
            makeUpstreamSong({ id: 'oct_10', title: 'Oct Ten Track', releaseDate: '2026-10-10', playCount: 62000 }),
            makeUpstreamSong({ id: 'oct_08', title: 'Oct Eight Track', releaseDate: '2026-10-08', playCount: 73000 }),
          ],
        }),
      }
    })

    const res = await app.request('http://localhost/api/content/new-releases?languages=tamil,hindi&limit=6')
    expect(res.status).toBe(200)
    expect(seenCookies).toContain('L=tamil')
    expect(seenCookies).toContain('L=hindi')

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.results[0].id).toBe('brand_new_drop')
    expect(body.data.results[0].downloadUrl.at(-1)).toEqual({
      quality: '320kbps',
      url: 'https://aac.saavncdn.com/123/abcdef_320.mp4',
    })
  })

  it('fixes artist plain-string bio crashes, non-song suggestion crashes, and more_info.songs playlists', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (rawUrl) => {
      const u = new URL(String(rawUrl))
      const call = u.searchParams.get('__call')

      if (call === 'artist.getArtistPageDetails') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            artistId: '464932',
            name: 'Arijit Singh',
            bio: 'Arijit Singh is an Indian playback singer.',
            image: 'https://c.saavncdn.com/artists/Arijit_150x150.jpg',
            similarArtists: [
              {
                id: '458805',
                name: 'Sonu Nigam',
                perma_url: 'https://www.jiosaavn.com/artist/sonu',
                image_url: 'https://c.saavncdn.com/artists/Sonu_150x150.jpg',
                languages: 'Hindi, Kannada',
                bio: 'Sonu Nigam playback vocalist',
                similar: 'Shaan',
              },
            ],
          }),
        }
      }

      if (call === 'webradio.createEntityStation') {
        return { ok: true, status: 200, json: async () => ({ stationid: 'st_999' }) }
      }

      if (call === 'webradio.getSong') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            stationid: 'st_999',
            error: null,
            meta: { status: 'ok' },
            0: { song: makeUpstreamSong({ id: 'sug_1', title: 'Suggested Fresh Song', releaseDate: '2026-10-22' }) },
          }),
        }
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: '802336660',
          title: 'Fresh Hits Playlist',
          header_desc: 'Updated daily',
          type: 'playlist',
          image: 'https://c.saavncdn.com/editorial/pl_150x150.jpg',
          list_count: '1',
          list: '',
          more_info: {
            artists: [],
            songs: [makeUpstreamSong({ id: 'pl_song_1', title: 'Playlist Track One', releaseDate: '2026-10-21' })],
          },
        }),
      }
    })

    const artistRes = await app.request('http://localhost/api/artists/464932')
    expect(artistRes.status).toBe(200)
    const artistBody = await artistRes.json()
    expect(artistBody.data.name).toBe('Arijit Singh')
    expect(artistBody.data.bio).toBe('Arijit Singh is an Indian playback singer.')

    const sugRes = await app.request('http://localhost/api/songs/abc123/suggestions?limit=5')
    expect(sugRes.status).toBe(200)
    const sugBody = await sugRes.json()
    expect(sugBody.data).toHaveLength(1)
    expect(sugBody.data[0].id).toBe('sug_1')

    const plRes = await app.request('http://localhost/api/playlists?id=802336660&limit=20')
    expect(plRes.status).toBe(200)
    const plBody = await plRes.json()
    expect(plBody.data.songs).toHaveLength(1)
    expect(plBody.data.songs[0].id).toBe('pl_song_1')
  })

  it('renders live New Releases on Home and automatically refreshes to stream newly dropped tracks', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const playlistBody = fixtures.routes.find((r) => r.pattern.includes('search/playlists')).body
    let releaseWave = 1

    vi.stubGlobal(
      'fetch',
      vi.fn(async (rawUrl) => {
        const u = String(rawUrl)
        if (u.includes('/content/new-releases')) {
          const songName = releaseWave === 1 ? 'Morning Fresh Release' : 'Midnight Brand New Drop'
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                total: 1,
                start: 0,
                results: [
                  {
                    id: `drop_${releaseWave}`,
                    name: songName,
                    language: 'tamil',
                    artists: { primary: [{ id: 'a1', name: 'Anirudh' }] },
                    image: [{ quality: '500x500', url: 'https://placehold.co/500x500' }],
                    downloadUrl: [{ quality: '320kbps', url: `https://aac.saavncdn.com/drop_${releaseWave}_320.mp4` }],
                  },
                ],
              },
            }),
          }
        }
        if (u.includes('/content/trending')) {
          return { ok: true, status: 200, json: async () => ({ success: true, data: { results: [] } }) }
        }
        return { ok: true, status: 200, json: async () => playlistBody }
      })
    )

    render(
      <SettingsProvider>
        <StatusProvider>
          <UIProvider>
            <FeedView />
          </UIProvider>
        </StatusProvider>
      </SettingsProvider>
    )

    await waitFor(() => expect(screen.getByText('Morning Fresh Release')).toBeInTheDocument())
    expect(screen.getByText('New Releases')).toBeInTheDocument()

    // Simulate a new song dropping on JioSaavn and verify the automatic refresh picks it up live!
    releaseWave = 2
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_FEED_REFRESH_MS + 100)
    })

    await waitFor(() => expect(screen.getByText('Midnight Brand New Drop')).toBeInTheDocument())
  })
})
