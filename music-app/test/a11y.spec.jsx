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
 * Accessibility smoke test over every reachable surface.
 *
 * The design is icon-heavy, and an icon-only control is invisible to anyone
 * using a screen reader unless it is named. Rather than trust a review pass,
 * mount the shell, walk each surface and assert three invariants:
 *
 *   - every button and link has an accessible name;
 *   - every image has an alt attribute (empty for decorative artwork);
 *   - no slider advertises a zero-length range, and no `undefined`, `NaN` or
 *     `[object Object]` leaked into markup.
 */
const body = (payload) => ({ ok: true, status: 200, json: async () => payload })
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
  for (const [prefix, payload] of ROUTES) if (target.includes(prefix)) return body(payload)
  return body({ success: false, message: 'not found' })
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

function problems() {
  const found = []
  const html = document.body.innerHTML

  for (const match of html.matchAll(/<(button|a)\b([^>]*)>/g)) {
    const attrs = match[2]
    const rest = html.slice(match.index + match[0].length)
    const inner = rest.slice(0, Math.max(0, rest.indexOf('</' + match[1] + '>')))
    const name =
      (/aria-label="([^"]*)"/.exec(attrs) || [])[1] ||
      (/title="([^"]*)"/.exec(attrs) || [])[1] ||
      inner.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    if (!name) found.push('unnamed <' + match[1] + '> ' + attrs.slice(0, 120))
  }

  for (const match of html.matchAll(/<img\b([^>]*)>/g)) {
    if (!/\balt=/.test(match[1])) found.push('img without alt: ' + match[1].slice(0, 100))
  }

  for (const match of html.matchAll(/<input\b([^>]*)>/g)) {
    const attrs = match[1]
    const labelled = /aria-label=|aria-labelledby=/.test(attrs) || /id="/.test(attrs)
    if (!labelled) found.push('input without a label: ' + attrs.slice(0, 100))
    if (/aria-valuemax="0"/.test(attrs)) found.push('slider with a zero maximum')
  }

  const leak = /(?:undefined|NaN|\[object Object\])/.exec(html)
  if (leak) found.push('leaked value near: ' + html.slice(Math.max(0, leak.index - 40), leak.index + 40))

  return found
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

describe('accessible surfaces', () => {
  it('names every control on the editorial home', async () => {
    mount()
    await screen.findByText(/Featured playlist/i)
    expect(problems()).toEqual([])
  })

  it('names every control in search results, in both themes', async () => {
    const { container } = mount()
    await screen.findByText(/Featured playlist/i)
    const input = container.querySelector('#searchInput')
    await userEvent.clear(input)
    await userEvent.type(input, 'verification{Enter}')
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBeGreaterThan(0))
    expect(problems()).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: /Switch to light theme/i }))
    expect(document.body.classList.contains('light')).toBe(true)
    expect(problems()).toEqual([])
  })

  it('names every control in a playlist, its modal and the settings sheet', async () => {
    const { container } = mount()
    await screen.findByText(/Featured playlist/i)
    await userEvent.click(container.querySelector('.shelf-row .card'))
    await waitFor(() => expect(container.querySelector('#detailTitle')).toBeTruthy())
    await waitFor(() => expect(container.querySelector('.song-row .pl-btn')).toBeTruthy())
    expect(problems()).toEqual([])

    await userEvent.click(container.querySelector('.song-row .pl-btn'))
    await waitFor(() => expect(container.querySelector('#plModal')).toBeTruthy())
    expect(problems()).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: /Playback settings/i }))
    expect(problems()).toEqual([])
  })

  it('names every control in the library and the listening stats', async () => {
    const { container } = mount()
    await screen.findByText(/Featured playlist/i)
    const side = within(container.querySelector('#sidebar'))
    await userEvent.click(side.getByRole('button', { name: /Library/i }))
    expect(problems()).toEqual([])
    await userEvent.click(side.getByRole('button', { name: /Stats/i }))
    expect(problems()).toEqual([])
  })
})
