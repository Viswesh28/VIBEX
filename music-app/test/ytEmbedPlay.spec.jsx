import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App.jsx'
import { LibraryProvider } from '../src/state/LibraryContext.jsx'
import { PlayerProvider } from '../src/state/PlayerContext.jsx'
import { SettingsProvider } from '../src/state/SettingsContext.jsx'
import { StatusProvider } from '../src/state/StatusContext.jsx'
import { UIProvider } from '../src/state/UIContext.jsx'
import { fixtures } from './fixtures/api.js'

/**
 * A YouTube item is a queue item, not a modal curiosity.
 *
 * The report that started this was "YouTube tracks do not play". The wiring in
 * the player was fine; what these tests pin is that pressing one actually opens
 * the embed, that the queue moves onto it (so the bar and MediaSession describe
 * what is playing), and that the end of a video advances the queue exactly like
 * an `<audio>` deck does.
 */
const jsonResponse = (payload) => ({ ok: true, status: 200, json: async () => payload })

const ytResult = (n) => ({
  videoId: n === 1 ? 'J7p4bzqLvCw' : 'dQw4w9WgXcQ',
  title: n === 1 ? 'Blinding Lights' : 'Save Your Tears',
  artists: ['The Weeknd'],
  album: 'After Hours',
  subtitle: 'The Weeknd • After Hours • 3:20',
  duration: 200,
  thumbnail: 'https://lh3.googleusercontent.com/thumb',
})

const YT_BODY = {
  success: true,
  data: { source: 'ytmusic', total: 2, results: [ytResult(1), ytResult(2)] },
}

const ROUTES = [
  ['/api/search/songs', fixtures.routes[0].body],
  ['/api/search/playlists', fixtures.routes[1].body],
  ['/api/search/albums', fixtures.routes[2].body],
  ['/api/search/artists', fixtures.routes[3].body],
  ['/api/playlists', fixtures.routes[5].body],
  ['/api/albums', fixtures.routes[6].body],
  ['/api/artists', fixtures.routes[7].body],
  ['/api/ytmusic', YT_BODY],
]

const fetchMock = vi.fn(async (url) => {
  const target = String(url)
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

/** What YouTube posts to the parent once the JS API handshake is up. */
function fromYouTube(event, info) {
  // jsdom gives an iframe a real contentWindow, and the component only trusts
  // messages from the frame it owns — so the event has to come from it.
  const frame = document.querySelector('#ytEmbedFrame')
  window.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify({ event, info }),
      origin: 'https://www.youtube.com',
      source: frame?.contentWindow ?? null,
    })
  )
}

const embedSrc = () => document.querySelector('#ytEmbedFrame')?.getAttribute('src') || ''

beforeEach(() => {
  localStorage.clear()
  document.body.className = ''
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function playFirstYouTubeResult(container) {
  const user = userEvent.setup()
  await screen.findByText(/Featured playlist/i)
  await user.click(screen.getByRole('button', { name: 'YT Music' }))
  const input = container.querySelector('#searchInput')
  await userEvent.clear(input)
  await userEvent.type(input, 'weeknd{Enter}')
  await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBeGreaterThan(0))
  await userEvent.click(container.querySelector('.song-row'))
  await waitFor(() => expect(document.querySelector('#ytEmbed')).toBeTruthy())
}

describe('playing a YouTube item', () => {
  it('opens YouTube’s player on the video the row points at', async () => {
    const { container } = mount()
    await playFirstYouTubeResult(container)
    expect(embedSrc()).toContain('/embed/J7p4bzqLvCw')
    // The URL still opts into the handshake the error reporting needs.
    expect(embedSrc()).toContain('enablejsapi=1')
  })

  it('makes the queue describe the item, so it is playing rather than idle', async () => {
    const { container } = mount()
    await playFirstYouTubeResult(container)
    await waitFor(() =>
      expect(container.querySelector('#pTitle').textContent).toContain('Blinding Lights')
    )
  })

  it('advances to the next item when the video ends, like an audio deck', async () => {
    const { container } = mount()
    await playFirstYouTubeResult(container)
    fromYouTube('onStateChange', 0)
    await waitFor(() => expect(embedSrc()).toContain('/embed/dQw4w9WgXcQ'))
  })

  it('reports a refusal instead of saying nothing', async () => {
    const { container } = mount()
    await playFirstYouTubeResult(container)
    fromYouTube('onError', 150)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/disabled playback outside YouTube/i)
    expect(alert.querySelector('a')).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=J7p4bzqLvCw'
    )
  })
})
