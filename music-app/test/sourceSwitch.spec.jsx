import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App.jsx'
import { clearApiCache } from '../src/lib/api.js'
import { LibraryProvider } from '../src/state/LibraryContext.jsx'
import { PlayerProvider } from '../src/state/PlayerContext.jsx'
import { SettingsProvider } from '../src/state/SettingsContext.jsx'
import { StatusProvider } from '../src/state/StatusContext.jsx'
import { UIProvider } from '../src/state/UIContext.jsx'
import { BROWSE_ONLY_NOTE, SOURCE_ID, sourceOf } from '../src/lib/sources.js'
import { fixtures } from './fixtures/api.js'

/**
 * The source choice is a *header* control, not a search-results control.
 *
 * Switching sources (YT <-> Saavn), typing a new search, or loading more results
 * is a browsing action and MUST NEVER wipe or reset an already playing track.
 */
const jsonResponse = (payload) => ({ ok: true, status: 200, json: async () => payload })

const YT_BODY = {
  success: true,
  data: {
    source: 'ytmusic',
    total: 2,
    nextPageToken: 'page_2',
    results: [
      {
        videoId: 'J7p4bzqLvCw',
        title: 'Blinding Lights',
        artists: ['The Weeknd'],
        album: 'After Hours',
        subtitle: 'The Weeknd • After Hours • 3:20',
        duration: 200,
        thumbnail: 'https://lh3.googleusercontent.com/thumb-bl',
        downloadUrl: [{ quality: '320kbps', url: 'https://aac.saavncdn.com/blinding-lights_320.mp4' }],
      },
      {
        videoId: 'ytLiveOnly99',
        title: 'Midnight Acoustic Session',
        artists: ['Indie Collective'],
        subtitle: 'Indie Collective • Live • 4:10',
        duration: 250,
        thumbnail: 'https://i.ytimg.com/vi/ytLiveOnly99/hqdefault.jpg',
      },
    ],
  },
}

const YT_PAGE_2_BODY = {
  success: true,
  data: {
    source: 'ytmusic',
    total: 3,
    nextPageToken: null,
    results: [
      {
        videoId: 'saveTears88',
        title: 'Save Your Tears',
        artists: ['The Weeknd'],
        album: 'After Hours',
        subtitle: 'The Weeknd • After Hours • 3:35',
        duration: 215,
        thumbnail: 'https://lh3.googleusercontent.com/thumb-syt',
        downloadUrl: [{ quality: '320kbps', url: 'https://aac.saavncdn.com/save-tears_320.mp4' }],
      },
    ],
  },
}

const ROUTES = [
  ['/api/search/songs', fixtures.routes[0].body],
  ['/api/search/playlists', fixtures.routes[1].body],
  ['/api/search/albums', fixtures.routes[2].body],
  ['/api/search/artists', fixtures.routes[3].body],
  ['/api/playlists', fixtures.routes[5].body],
  ['/api/albums', fixtures.routes[6].body],
  ['/api/artists', fixtures.routes[7].body],
]

const fetchMock = vi.fn(async (url) => {
  const target = String(url)
  if (target.includes('/api/ytmusic')) {
    return jsonResponse(target.includes('pageToken=page_2') ? YT_PAGE_2_BODY : YT_BODY)
  }
  for (const [prefix, body] of ROUTES) {
    if (target.includes(prefix)) return jsonResponse(body)
  }
  return jsonResponse({ success: false, message: 'not found' })
})

function mount() {
  return render(
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
}

const header = () => document.querySelector('#topbar')

beforeEach(() => {
  localStorage.clear()
  clearApiCache()
  document.body.className = ''
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockClear()
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function mockPlay() {
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  })
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(function mockPause() {
    this.dispatchEvent(new Event('pause'))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('choosing a music source', () => {
  it('puts both sources in the header before any search has been made', async () => {
    mount()
    await screen.findByRole('heading', { name: /Listen Now/i })

    const group = within(header()).getByRole('group', { name: 'Music source' })
    expect(within(group).getByRole('button', { name: 'Saavn' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(within(group).getByRole('button', { name: 'YT Music' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('states the limit at the moment of choosing, in the registry’s own words', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('heading', { name: /Listen Now/i })

    expect(sourceOf(SOURCE_ID.ytmusic).note).toBe(BROWSE_ONLY_NOTE)

    await user.click(screen.getByRole('button', { name: 'YT Music' }))
    expect(screen.getByRole('note')).toHaveTextContent(BROWSE_ONLY_NOTE)
    expect(localStorage.getItem('svSource')).toBe(SOURCE_ID.ytmusic)
  })

  it('turns the limit into an action that switches back', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('heading', { name: /Listen Now/i })

    await user.click(screen.getByRole('button', { name: 'YT Music' }))
    expect(screen.getByRole('note')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Use JioSaavn' }))
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    expect(localStorage.getItem('svSource')).toBe(SOURCE_ID.jiosaavn)
    expect(screen.getByRole('button', { name: 'Saavn' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('rewires the search to the chosen catalogue, without a second switch in the results', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('heading', { name: /Listen Now/i })

    await user.click(screen.getByRole('button', { name: 'YT Music' }))
    const input = screen.getByLabelText(/Search songs, albums, playlists and artists/i)
    await user.clear(input)
    await user.type(input, 'blinding lights{Enter}')

    const calls = () => fetchMock.mock.calls.map(([u]) => String(u))
    await waitFor(() => expect(calls().some((u) => u.includes('/api/ytmusic?'))).toBe(true))
    const called = calls().find((u) => u.includes('/api/ytmusic?'))
    expect(called).toContain('query=blinding%20lights')

    expect(screen.getAllByRole('group', { name: 'Music source' })).toHaveLength(1)
  })

  it('keeps the active YT track, playhead, and playback state completely intact when switching from YT to Saavn', async () => {
    const user = userEvent.setup()
    const { container } = mount()
    await screen.findByRole('heading', { name: /Listen Now/i })

    // 1. Switch to YT Music, search, and start playing a YT track.
    await user.click(screen.getByRole('button', { name: 'YT Music' }))
    const input = screen.getByLabelText(/Search songs, albums, playlists and artists/i)
    await user.clear(input)
    await user.type(input, 'blinding lights{Enter}')

    const playBtn = await screen.findByRole('button', { name: 'Play Blinding Lights' })
    await user.click(playBtn)

    expect(document.querySelector('#pTitle')).toHaveTextContent('Blinding Lights')
    expect(document.querySelector('#pArtist')).toHaveTextContent('The Weeknd')

    // Advance playhead to 42s so we also prove clock & active deck stay untouched.
    const audioEl = container.querySelector('audio')
    await act(async () => {
      Object.defineProperty(audioEl, 'currentTime', { value: 42, configurable: true })
      Object.defineProperty(audioEl, 'duration', { value: 200, configurable: true })
      fireEvent.timeUpdate(audioEl)
    })
    expect(document.querySelector('#pTime')).toHaveTextContent('0:42 / 3:20')

    // 2. Also click "Load more tracks" while playing — player must NOT reset.
    await user.click(await screen.findByRole('button', { name: 'Load more tracks' }))
    await screen.findByRole('button', { name: 'Play Save Your Tears' })
    expect(document.querySelector('#pTitle')).toHaveTextContent('Blinding Lights')
    expect(document.querySelector('#pTime')).toHaveTextContent('0:42 / 3:20')

    // 3. Now switch source from YT Music -> Saavn in the header!
    await user.click(screen.getByRole('button', { name: 'Saavn' }))

    // JioSaavn search results load into the view...
    const saavnPlayBtn = await screen.findByRole('button', {
      name: `Play ${fixtures.routes[0].body.data.results[0].name}`,
    })
    expect(saavnPlayBtn).toBeInTheDocument()

    // ...and the player NEVER reset! Active YT song, artist, playhead, and Pause button remain intact!
    expect(document.querySelector('#pTitle')).toHaveTextContent('Blinding Lights')
    expect(document.querySelector('#pTitle')).not.toHaveTextContent('Nothing playing')
    expect(document.querySelector('#pArtist')).toHaveTextContent('The Weeknd')
    expect(document.querySelector('#pTime')).toHaveTextContent('0:42 / 3:20')
    expect(within(document.querySelector('#playerBar')).getByRole('button', { name: 'Pause' })).toBeInTheDocument()

    // 4. Only when the user explicitly clicks a Saavn song does playback switch to that Saavn track!
    await user.click(saavnPlayBtn)
    expect(document.querySelector('#pTitle')).toHaveTextContent(
      fixtures.routes[0].body.data.results[0].name
    )
  })

  it('keeps an unmatched YouTube embed transport intact when switching from YT to Saavn until a new track is chosen', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('heading', { name: /Listen Now/i })

    await user.click(screen.getByRole('button', { name: 'YT Music' }))
    const input = screen.getByLabelText(/Search songs, albums, playlists and artists/i)
    await user.clear(input)
    await user.type(input, 'acoustic{Enter}')

    const playUnmatched = await screen.findByRole('button', { name: 'Play Midnight Acoustic Session' })
    await user.click(playUnmatched)

    await waitFor(() => {
      expect(document.querySelector('#pTitle')).toHaveTextContent('Midnight Acoustic Session')
    })

    // Click "Use JioSaavn" action button in the banner while the YT transport is active.
    await user.click(screen.getByRole('button', { name: 'Use JioSaavn' }))

    const saavnPlayBtn = await screen.findByRole('button', {
      name: `Play ${fixtures.routes[0].body.data.results[0].name}`,
    })
    expect(saavnPlayBtn).toBeInTheDocument()

    // Player is NOT reset to "Nothing playing" when switching to Saavn!
    expect(document.querySelector('#pTitle')).toHaveTextContent('Midnight Acoustic Session')
    expect(document.querySelector('#pTitle')).not.toHaveTextContent('Nothing playing')

    // Selecting a JioSaavn song cleanly tears down the YouTube iframe and starts the Saavn song.
    await user.click(saavnPlayBtn)
    expect(document.querySelector('#ytEmbed')).toBeNull()
    expect(document.querySelector('#pTitle')).toHaveTextContent(
      fixtures.routes[0].body.data.results[0].name
    )
  })
})
