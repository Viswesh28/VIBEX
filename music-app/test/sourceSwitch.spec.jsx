import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App.jsx'
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
 * An earlier revision put the switch inside the song results, so the app only
 * revealed it had two catalogues after a search — and a listener browsing the
 * home feed never saw it at all. These tests pin the new contract: the choice
 * is on screen from the moment the shell mounts, the limit is stated beside it
 * in the same words the registry uses, and switching rewires the search.
 */
const jsonResponse = (payload) => ({ ok: true, status: 200, json: async () => payload })

const YT_BODY = {
  success: true,
  data: {
    source: 'ytmusic',
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

const header = () => document.querySelector('#topbar')

beforeEach(() => {
  localStorage.clear()
  document.body.className = ''
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockClear()
})

afterEach(() => {
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
    // The unpicked source is advertised rather than hidden behind the pick.
    expect(within(group).getByRole('button', { name: 'YT Music' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('states the limit at the moment of choosing, in the registry’s own words', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('heading', { name: /Listen Now/i })

    // One sentence, one source of truth: a paraphrase here would drift.
    expect(sourceOf(SOURCE_ID.ytmusic).note).toBe(BROWSE_ONLY_NOTE)

    await user.click(screen.getByRole('button', { name: 'YT Music' }))
    expect(screen.getByRole('note')).toHaveTextContent(BROWSE_ONLY_NOTE)
    // Stored as a plain string, like every other sv* preference.
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
    // The home feed pre-fills a query; the search must be the one we typed.
    await user.clear(input)
    await user.type(input, 'blinding lights{Enter}')

    // The spy is called as (url, init), so read the calls rather than match arity.
    const calls = () => fetchMock.mock.calls.map(([u]) => String(u))
    await waitFor(() => expect(calls().some((u) => u.includes('/api/ytmusic?'))).toBe(true))
    const called = calls().find((u) => u.includes('/api/ytmusic?'))
    // The handler is a file route at api/ytmusic.mjs — not /api/ytmusic/search.
    expect(called).toContain('query=blinding%20lights')

    // The header keeps the only switch; the results list must not repeat it.
    expect(screen.getAllByRole('group', { name: 'Music source' })).toHaveLength(1)
  })
})
