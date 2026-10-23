import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  buildMatchQueries,
  cleanChannelArtist,
  matchSaavnTrack,
  parseIsoDuration,
} from '../src/lib/trackMatch.js'
import {
  enrichResultsWithSaavnAudio,
  parseYtDataApiResponse,
  toResult,
} from '../../api/ytmusic.mjs'
import { createYtMusicStreamResolver } from '../src/lib/providers.js'
import App from '../src/App.jsx'
import { LibraryProvider } from '../src/state/LibraryContext.jsx'
import { PlayerProvider } from '../src/state/PlayerContext.jsx'
import { SettingsProvider } from '../src/state/SettingsContext.jsx'
import { StatusProvider } from '../src/state/StatusContext.jsx'
import { UIProvider } from '../src/state/UIContext.jsx'
import { fixtures } from './fixtures/api.js'

const studioCandidate = ({
  id = 'saavn_blinding',
  name = 'Blinding Lights',
  artist = 'The Weeknd',
  album = 'After Hours',
  duration = 200,
  streamUrl = 'https://aac.saavncdn.com/blinding_320.mp4',
} = {}) => ({
  id,
  name,
  duration,
  album: { id: 'alb_1', name: album },
  artists: { primary: [{ id: 'art_weeknd', name: artist }], all: [] },
  image: [{ quality: '500x500', url: 'https://c.saavncdn.com/after_hours_500.jpg' }],
  downloadUrl: [
    { quality: '96kbps', url: 'https://aac.saavncdn.com/blinding_96.mp4' },
    { quality: '320kbps', url: streamUrl },
  ],
})

describe('Official YouTube Data API v3 parser & helpers', () => {
  it('parses ISO-8601 durations cleanly into integer seconds', () => {
    expect(parseIsoDuration('PT3M20S')).toBe(200)
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723)
    expect(parseIsoDuration('PT45S')).toBe(45)
    expect(parseIsoDuration('')).toBe(0)
  })

  it('cleans channel suffixes (- Topic, VEVO) without mangling artist names', () => {
    expect(cleanChannelArtist('Anirudh Ravichander - Topic')).toBe('Anirudh Ravichander')
    expect(cleanChannelArtist('TheWeekndVEVO')).toBe('The Weeknd')
  })

  it('maps search.list + videos.list responses with durations and pagination tokens', () => {
    const searchJson = {
      nextPageToken: 'CDIQAA',
      items: [
        {
          id: { videoId: 'J7p4bzqLvCw' },
          snippet: {
            title: 'Blinding Lights',
            channelTitle: 'The Weeknd - Topic',
            thumbnails: { high: { url: 'https://i.ytimg.com/vi/J7p4bzqLvCw/hqdefault.jpg' } },
          },
        },
      ],
    }
    const videosJson = {
      items: [
        {
          id: 'J7p4bzqLvCw',
          snippet: searchJson.items[0].snippet,
          contentDetails: { duration: 'PT3M20S' },
        },
      ],
    }
    const parsed = parseYtDataApiResponse(searchJson, videosJson, 20)
    expect(parsed.nextPageToken).toBe('CDIQAA')
    expect(parsed.results).toEqual([
      {
        videoId: 'J7p4bzqLvCw',
        title: 'Blinding Lights',
        artists: ['The Weeknd'],
        album: null,
        subtitle: 'The Weeknd',
        duration: 200,
        thumbnail: 'https://i.ytimg.com/vi/J7p4bzqLvCw/hqdefault.jpg',
        explicit: false,
      },
    ])
  })
})

describe('cross-catalog studio audio matching', () => {
  it('matches noisy Tamil, Hindi, and English YouTube titles to studio tracks', () => {
    const tamilYt = {
      videoId: 'yt_arabic_kuthu',
      title: 'Arabic Kuthu - Video Song | Beast | Thalapathy Vijay | Sun Pictures | Anirudh',
      artists: ['Sun TV'],
      duration: 282,
    }
    expect(buildMatchQueries(tamilYt)[0]).toContain('Arabic Kuthu')

    const tamilSaavn = studioCandidate({
      id: 'saavn_arabic',
      name: 'Arabic Kuthu - Halamithi Habibo (From &quot;Beast&quot;)',
      artist: 'Anirudh Ravichander',
      album: 'Beast',
      duration: 279,
    })
    const hit = matchSaavnTrack(tamilYt, [tamilSaavn])
    expect(hit?.song.id).toBe('saavn_arabic')
    expect(hit?.score).toBeGreaterThanOrEqual(0.68)
  })

  it('strictly rejects unrelated songs even if artist or duration matches', () => {
    const yt = {
      videoId: 'J7p4bzqLvCw',
      title: 'Blinding Lights',
      artists: ['The Weeknd'],
      duration: 200,
    }
    const wrongSong = studioCandidate({
      id: 'saavn_wrong',
      name: 'Save Your Tears',
      artist: 'The Weeknd',
      duration: 200,
    })
    expect(matchSaavnTrack(yt, [wrongSong])).toBeNull()
  })

  it('rejects matching a studio single when the user requested a karaoke/lofi cover', () => {
    const karaokeYt = {
      videoId: 'yt_karaoke11',
      title: 'Blinding Lights (Karaoke Instrumental Cover)',
      artists: ['Sing King'],
      duration: 200,
    }
    expect(matchSaavnTrack(karaokeYt, [studioCandidate()])).toBeNull()
  })

  it('enriches server YouTube results in parallel and resolves to pure audio streams', async () => {
    const rawResults = [
      {
        videoId: 'J7p4bzqLvCw',
        title: 'Blinding Lights (Official Audio)',
        artists: ['The Weeknd'],
        duration: 200,
        thumbnail: 'https://lh3.googleusercontent.com/thumb',
      },
      {
        videoId: 'unmatchedVid',
        title: 'Exclusive Live Bedroom Acoustic Jam #42',
        artists: ['Indie Creator'],
        duration: 185,
        thumbnail: 'https://lh3.googleusercontent.com/thumb2',
      },
    ]

    const enriched = await enrichResultsWithSaavnAudio(rawResults, {
      saavnSearchFn: async () => [studioCandidate()],
    })
    expect(enriched[0].matchedAudio?.songId).toBe('saavn_blinding')
    expect(enriched[0].matchedAudio?.downloadUrl).toHaveLength(2)
    expect(enriched[1].matchedAudio).toBeUndefined()

    // Seed pool fast path resolves matching tracks with zero per-row search calls.
    const spySearch = vi.fn(async () => [])
    const seeded = await enrichResultsWithSaavnAudio([rawResults[0]], {
      saavnSearchFn: spySearch,
      seedCandidates: [studioCandidate()],
    })
    expect(seeded[0].matchedAudio?.songId).toBe('saavn_blinding')
    expect(spySearch).not.toHaveBeenCalled()

    const resolver = createYtMusicStreamResolver({
      apiFn: async () => ({ results: [studioCandidate()] }),
      apiFetchFn: async () => ({ ok: false, status: 404, json: async () => ({}) }),
      getOrigin: () => 'https://vibex.example.app',
    })
    const streamPlan = await resolver.resolve('ytmusic:J7p4bzqLvCw', '320kbps', {
      track: {
        id: 'yt:J7p4bzqLvCw',
        videoId: 'J7p4bzqLvCw',
        name: 'Blinding Lights',
        artists: { primary: [{ name: 'The Weeknd' }] },
        duration: 200,
      },
    })
    expect(streamPlan.mode).toBe('stream')
    expect(streamPlan.uri).toBe('https://aac.saavncdn.com/blinding_320.mp4')
  })

  it('parses modern WEB_REMIX subtitles containing leading type chips and trailing play/view counts', () => {
    const modernSongRow = toResult({
      playlistItemData: { videoId: 'J7p4bzqLvCw' },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Blinding Lights' }] } } },
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: { runs: [{ text: 'Song • The Weeknd • After Hours • 3:20 • 2.4B plays' }] },
          },
        },
      ],
    })
    expect(modernSongRow.duration).toBe(200)
    expect(modernSongRow.artists).toEqual(['The Weeknd'])
    expect(modernSongRow.album).toBe('After Hours')

    const modernVideoRow = toResult({
      playlistItemData: { videoId: '1F3hm6MfR1k' },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Hukum - Lyric Video' }] } } },
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: { runs: [{ text: 'Video • Sun TV • 452M views • 3:28' }] },
          },
        },
      ],
    })
    expect(modernVideoRow.duration).toBe(208)
    expect(modernVideoRow.artists).toEqual(['Sun TV'])
    expect(modernVideoRow.album).toBeNull()
  })

  it('matches regional label-channel uploads with zero duration and romanization spelling differences', () => {
    const labelUpload = {
      name: 'Hukum',
      artists: ['Sun TV'],
      duration: 0,
    }
    const hukumStudio = studioCandidate({
      id: 'saavn_hukum',
      name: 'Hukum - Thalaivar Alappara (From "Jailer")',
      artist: 'Anirudh Ravichander, Super Subu',
      album: 'Jailer',
      duration: 207,
      streamUrl: 'https://aac.saavncdn.com/hukum_320.mp4',
    })
    expect(matchSaavnTrack(labelUpload, [hukumStudio])?.song?.id).toBe('saavn_hukum')

    const translitYt = {
      name: 'Manasilaayo (From "Vettaiyan")',
      artists: ['Sony Music South'],
      duration: 0,
    }
    const translitSaavn = studioCandidate({
      id: 'saavn_manasilayo',
      name: 'Manasilayo',
      artist: 'Anirudh Ravichander, Malaysia Vasudevan',
      album: 'Vettaiyan',
      duration: 245,
      streamUrl: 'https://aac.saavncdn.com/manasilayo_320.mp4',
    })
    expect(matchSaavnTrack(translitYt, [translitSaavn])?.song?.id).toBe('saavn_manasilayo')
  })
})

describe('YouTube Music pure track playback in the UI', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.className = ''
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('plays matched YouTube Music tracks directly on <audio> like JioSaavn without opening the video modal', async () => {
    const playSpy = vi
      .spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve())

    const jsonResponse = (payload) => ({ ok: true, status: 200, json: async () => payload })
    const enrichedYtBody = {
      success: true,
      data: {
        source: 'ytmusic',
        providerMode: 'ytmusic-catalog',
        total: 1,
        results: [
          {
            videoId: 'J7p4bzqLvCw',
            title: 'Blinding Lights',
            artists: ['The Weeknd'],
            album: 'After Hours',
            subtitle: 'The Weeknd • After Hours • 3:20',
            duration: 200,
            thumbnail: 'https://lh3.googleusercontent.com/thumb',
            matchedAudio: {
              provider: 'jiosaavn',
              songId: 'saavn_blinding',
              album: { id: 'alb_1', name: 'After Hours' },
              artists: { primary: [{ id: 'art_weeknd', name: 'The Weeknd' }], all: [] },
              duration: 200,
              image: [{ quality: '500x500', url: 'https://c.saavncdn.com/after_hours_500.jpg' }],
              downloadUrl: [{ quality: '320kbps', url: 'https://aac.saavncdn.com/blinding_320.mp4' }],
            },
          },
        ],
      },
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        const target = String(url)
        if (target.includes('/api/ytmusic')) return jsonResponse(enrichedYtBody)
        for (const [prefix, body] of fixtures.routes.map((r) => [r.path, r.body])) {
          if (target.includes(prefix)) return jsonResponse(body)
        }
        return jsonResponse(fixtures.routes[0].body)
      })
    )

    const user = userEvent.setup()
    const { container } = render(
      <StatusProvider>
        <SettingsProvider>
          <LibraryProvider>
            <PlayerProvider>
              <UIProvider>
                <App />
              </UIProvider>
            </PlayerProvider>
          </LibraryProvider>
        </SettingsProvider>
      </StatusProvider>
    )

    await screen.findByText(/Featured playlist/i)
    await user.click(screen.getByRole('button', { name: 'YT Music' }))
    const input = container.querySelector('#searchInput')
    await user.clear(input)
    await user.type(input, 'weeknd{Enter}')
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBe(1))
    await user.click(container.querySelector('.song-row'))

    await waitFor(() => {
      const decks = [...container.querySelectorAll('audio')]
      expect(decks.some((el) => el.src.includes('blinding_320.mp4'))).toBe(true)
    })
    expect(document.querySelector('#ytEmbed')).toBeNull()
    expect(container.querySelector('#pTitle').textContent).toContain('Blinding Lights')
    expect(playSpy).toHaveBeenCalled()
    playSpy.mockRestore()
  })

  it('syncs the bottom player bar controls and clock when playing an unmatched YouTube upload', async () => {
    const jsonResponse = (payload) => ({ ok: true, status: 200, json: async () => payload })
    const unmatchedYtBody = {
      success: true,
      data: {
        source: 'ytmusic',
        providerMode: 'ytmusic-catalog',
        total: 1,
        matchedCount: 0,
        results: [
          {
            videoId: 'Unmatch99xZ',
            title: 'Indie Rooftop Session #9',
            artists: ['Bedroom Collective'],
            subtitle: 'Bedroom Collective • 3:05',
            duration: 185,
            thumbnail: 'https://lh3.googleusercontent.com/thumb',
          },
        ],
      },
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        const target = String(url)
        if (target.includes('/api/ytmusic')) return jsonResponse(unmatchedYtBody)
        for (const [prefix, body] of fixtures.routes.map((r) => [r.path, r.body])) {
          if (target.includes(prefix)) return jsonResponse(body)
        }
        return jsonResponse(fixtures.routes[0].body)
      })
    )

    const user = userEvent.setup()
    const { container } = render(
      <StatusProvider>
        <SettingsProvider>
          <LibraryProvider>
            <PlayerProvider>
              <UIProvider>
                <App />
              </UIProvider>
            </PlayerProvider>
          </LibraryProvider>
        </SettingsProvider>
      </StatusProvider>
    )

    await screen.findByText(/Featured playlist/i)
    await user.click(screen.getByRole('button', { name: 'YT Music' }))
    const input = container.querySelector('#searchInput')
    await user.clear(input)
    await user.type(input, 'rooftop{Enter}')
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBe(1))
    await user.click(container.querySelector('.song-row'))

    await waitFor(() => expect(document.querySelector('#ytEmbed.is-docked')).toBeTruthy())
    const iframe = document.querySelector('#ytEmbedFrame')
    const posted = []
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage: (msg) => posted.push(JSON.parse(msg)) },
      configurable: true,
    })

    // Simulate YouTube IFrame API `infoDelivery` clock progress update.
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://www.youtube.com',
          source: iframe.contentWindow,
          data: JSON.stringify({
            event: 'infoDelivery',
            info: { currentTime: 65, duration: 185, playerState: 1 },
          }),
        })
      )
    })

    await waitFor(() =>
      expect(container.querySelector('#pTime')?.textContent).toBe('1:05 / 3:05')
    )

    // Clicking VIBEX's bottom-bar Pause button sends `pauseVideo` straight to the iframe.
    await user.click(container.querySelector('#playerBar .cbtn.main'))
    expect(posted.some((m) => m.func === 'pauseVideo')).toBe(true)
  })
})
