import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App.jsx'
import { LibraryProvider } from '../src/state/LibraryContext.jsx'
import { PlayerProvider } from '../src/state/PlayerContext.jsx'
import { SettingsProvider } from '../src/state/SettingsContext.jsx'
import { StatusProvider } from '../src/state/StatusContext.jsx'
import { UIProvider } from '../src/state/UIContext.jsx'
import { fixtures } from './fixtures/api.js'

/**
 * Whole-shell smoke test.
 *
 * The unit specs cover the pure helpers and a couple of components; this one
 * mounts the app the way main.jsx does and proves the pieces still fit:
 * providers, the API probe, the editorial home, the navigation chrome and the
 * empty player. The API is answered from the same fixtures the Playwright
 * scripts use, so it is deterministic and needs no network.
 */
const jsonResponse = (payload) => ({
  ok: true,
  status: 200,
  json: async () => payload,
})

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

beforeEach(() => {
  localStorage.clear()
  document.body.className = ''
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('app shell', () => {
  it('boots past the API probe into the Listen Now home', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: /Listen Now/i })).toBeInTheDocument()
    // Featured editorial pick is the first item of the first shelf.
    expect(await screen.findByText(/Featured playlist/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Verification Playlist 1' })).toBeInTheDocument()
  })

  it('renders one shelf per section, each inside the feed marker', async () => {
    const { container } = mount()
    await screen.findByText(/Featured playlist/i)
    await waitFor(() => expect(container.querySelectorAll('.shelf')).toHaveLength(4))
    expect(container.querySelectorAll('.feed-sec')).toHaveLength(4)
    expect(container.querySelectorAll('.shelf-row .card').length).toBeGreaterThan(10)
  })

  it('puts all four destinations in the phone tab bar and the sidebar', async () => {
    const { container } = mount()
    await screen.findByText(/Featured playlist/i)
    const nav = container.querySelector('#mobileNav')
    expect(nav).toBeTruthy()
    expect(within(nav).getByRole('button', { name: /Listen Now/i })).toBeInTheDocument()
    for (const label of ['Listen Now', 'Search', 'Library', 'Stats']) {
      expect(within(nav).getByRole('button', { name: new RegExp(label, 'i') })).toBeInTheDocument()
    }
    expect(container.querySelectorAll('#sidebar .nav-item').length).toBeGreaterThanOrEqual(4)
  })

  it('draws the player with VIBEX icons and no emoji transport glyphs', async () => {
    const { container } = mount()
    await screen.findByText(/Featured playlist/i)
    const bar = container.querySelector('#playerBar')
    expect(bar).toBeTruthy()
    expect(within(bar).getByText('Nothing playing')).toBeInTheDocument()
    // Every transport control is an SVG from Icon.jsx.
    expect(bar.querySelectorAll('button svg.icon').length).toBeGreaterThanOrEqual(6)
    // The old build used ⏮ ▶ ⏭ 🔀 🔁 — none of those may survive.
    expect(/[⏮⏭▶⏸🔀🔁🔂⬇♡♥]/.test(bar.textContent)).toBe(false)
  })

  it('searches from the top bar and renders song rows with icon actions', async () => {
    const { container } = mount()
    await screen.findByText(/Featured playlist/i)
    const input = container.querySelector('#searchInput')
    await userEvent.clear(input)
    await userEvent.type(input, 'verification{Enter}')
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBeGreaterThan(0))
    const row = container.querySelector('.song-row')
    expect(row.querySelector('.like-btn svg')).toBeTruthy()
    expect(row.querySelector('.pl-btn svg')).toBeTruthy()
    expect(row.querySelector('.radio-btn svg')).toBeTruthy()
  })


  it('plays a song from search, then opens the immersive player and lyrics', async () => {
    const { container } = mount()
    await screen.findByText(/Featured playlist/i)
    const input = container.querySelector('#searchInput')
    await userEvent.clear(input)
    await userEvent.type(input, 'verification{Enter}')
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBeGreaterThan(0))

    const firstRow = container.querySelector('.song-row')
    const title = firstRow.querySelector('.s-title').textContent
    await userEvent.click(firstRow)
    await waitFor(() => expect(container.querySelector('#pTitle').textContent).toContain(title))

    // The compact bar now has a track, so the immersive stage can open.
    await userEvent.click(screen.getByRole('button', { name: /Open the full-screen player/i }))
    expect(container.querySelector('#fullPlayer')).toHaveClass('open')
    expect(container.querySelector('#fpTitle').textContent).toContain(title)

    await userEvent.click(within(container.querySelector('#fullPlayer')).getByRole('button', { name: /Open synced lyrics/i }))
    expect(container.querySelector('#lyrOverlay')).toHaveClass('open')
    expect(within(container.querySelector('#lyrOverlay')).getByRole('dialog', { name: 'Lyrics' })).toBeInTheDocument()

    // Escape closes the top-most layer only.
    await userEvent.keyboard('{Escape}')
    expect(container.querySelector('#lyrOverlay')).not.toHaveClass('open')
    expect(container.querySelector('#fullPlayer')).toHaveClass('open')

    await userEvent.keyboard('{Escape}')
    expect(container.querySelector('#fullPlayer')).not.toHaveClass('open')
  })

  it('keeps the queue reachable from the right rail', async () => {
    const { container } = mount()
    await screen.findByText(/Featured playlist/i)
    // Four destinations, four rows: no queue items until something plays.
    expect(container.querySelector('#queueList')).toBeTruthy()
    expect(container.querySelector('.q-empty')).toBeTruthy()
  })

  it('renders a playlist page with a hero and rows when a card is opened', async () => {
    const { container } = mount()
    await screen.findByText(/Featured playlist/i)
    await userEvent.click(container.querySelector('.shelf-row .card'))
    await waitFor(() => expect(container.querySelector('#detailTitle')).toBeTruthy())
    expect(container.querySelector('#detailTitle').textContent).toMatch(/Verification Playlist/i)
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBeGreaterThan(0))
    await userEvent.click(within(container.querySelector('.hero-actions')).getByRole('button', { name: /Play/i }))
    await waitFor(() => expect(container.querySelector('#pTitle').textContent).toMatch(/Verification Track/i))
  })

  it('opens the playback settings, closes on outside click and Escape', async () => {
    const { container } = mount()
    await screen.findByText(/Featured playlist/i)
    const panel = container.querySelector('#setPanel')
    const trigger = screen.getByRole('button', { name: /Playback settings/i })
    expect(panel).not.toHaveClass('open')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(trigger)
    expect(panel).toHaveClass('open')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    // The panel is a popover: clicking the page behind it dismisses it.
    await userEvent.click(screen.getByRole('heading', { name: /Listen Now/i }))
    expect(panel).not.toHaveClass('open')

    await userEvent.click(trigger)
    expect(panel).toHaveClass('open')
    await userEvent.keyboard('{Escape}')
    expect(panel).not.toHaveClass('open')
  })

  it('toggles the theme on the body element', async () => {
    mount()
    await screen.findByText(/Featured playlist/i)
    expect(document.body.classList.contains('light')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: /Switch to light theme/i }))
    expect(document.body.classList.contains('light')).toBe(true)
  })

  it('opens the full-screen player from the compact bar', async () => {
    const { container } = mount()
    await screen.findByText(/Featured playlist/i)
    await userEvent.click(screen.getByRole('button', { name: /Open the full-screen player/i }))
    // No track yet, so the overlay stays closed rather than showing an empty stage.
    expect(container.querySelector('#fullPlayer').classList.contains('open')).toBe(false)
  })
})
