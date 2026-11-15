import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App.jsx'
import { isSubmitEnter } from '../src/lib/keys.js'
import { LibraryProvider } from '../src/state/LibraryContext.jsx'
import { PlayerProvider } from '../src/state/PlayerContext.jsx'
import { SettingsProvider } from '../src/state/SettingsContext.jsx'
import { StatusProvider } from '../src/state/StatusContext.jsx'
import { UIProvider } from '../src/state/UIContext.jsx'
import { fixtures } from './fixtures/api.js'

/**
 * Enter must not submit while an input method is confirming a word.
 *
 * Found by `npm run verify:modern-web` (guide `ime-safe-enter-submit`). With a
 * Tamil, Hindi or CJK input method, Enter picks the conversion candidate. The
 * old `key === 'Enter'` handlers then searched for — or saved a playlist as —
 * the half-composed text. These tests pin both inputs that submit on Enter.
 */
const jsonResponse = (payload) => ({ ok: true, status: 200, json: async () => payload })

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

/** The two ways a browser reports "this Enter confirms an IME word". */
const COMPOSING = [
  ['isComposing (Chrome, Edge, Firefox)', { key: 'Enter', isComposing: true }],
  ['keyCode 229 (Safari ends the composition first)', { key: 'Enter', keyCode: 229 }],
]

/** A native keydown; `keyCode` is legacy, so set it by hand if the init ignores it. */
function keydown({ keyCode, ...init }) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  if (keyCode !== undefined && event.keyCode !== keyCode) {
    Object.defineProperty(event, 'keyCode', { value: keyCode })
  }
  return event
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

describe('isSubmitEnter', () => {
  it('accepts a plain Enter', () => {
    expect(isSubmitEnter(keydown({ key: 'Enter', keyCode: 13 }))).toBe(true)
  })

  it.each(COMPOSING)('rejects an Enter that confirms an IME word — %s', (_, init) => {
    expect(isSubmitEnter(keydown(init))).toBe(false)
  })

  it('ignores every other key, including the 229 virtual keyboards send for letters', () => {
    expect(isSubmitEnter(keydown({ key: 'a', keyCode: 65 }))).toBe(false)
    expect(isSubmitEnter(keydown({ key: 'Process', keyCode: 229 }))).toBe(false)
    expect(isSubmitEnter(keydown({ key: 'Unidentified', keyCode: 229 }))).toBe(false)
  })

  it('reads isComposing from the native event behind a React synthetic event', () => {
    const composing = { key: 'Enter', keyCode: 13, nativeEvent: keydown({ key: 'Enter', isComposing: true }) }
    const plain = { key: 'Enter', keyCode: 13, nativeEvent: keydown({ key: 'Enter' }) }
    expect(isSubmitEnter(composing)).toBe(false)
    expect(isSubmitEnter(plain)).toBe(true)
  })
})

describe('Enter in the search box', () => {
  it('does not search while an IME confirms a word, and searches on a real Enter', async () => {
    mount()
    await screen.findByText(/Featured playlist/i)
    const input = screen.getByLabelText(/Search songs, albums, playlists and artists/i)
    fireEvent.change(input, { target: { value: 'imeprobe' } })
    const searched = () => fetchMock.mock.calls.some(([url]) => String(url).includes('imeprobe'))

    for (const [, init] of COMPOSING) fireEvent.keyDown(input, init)
    // Give a wrongly triggered search the chance to go out before asserting it did not.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(searched()).toBe(false)
    expect(screen.getByText(/Featured playlist/i)).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 })
    await waitFor(() => expect(searched()).toBe(true))
  })
})

describe('Enter in the playlist name field', () => {
  it('does not save while an IME confirms a word, and saves on a real Enter', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText(/Featured playlist/i)

    await user.click(screen.getByRole('button', { name: 'Create a playlist' }))
    const dialog = await screen.findByRole('dialog', { name: 'New playlist' })
    const input = within(dialog).getByLabelText('Playlist name')
    fireEvent.change(input, { target: { value: 'Kadhal mix' } })
    const sidebarPlaylists = () => document.querySelector('#plNav').textContent

    for (const [, init] of COMPOSING) fireEvent.keyDown(input, init)
    expect(screen.getByRole('dialog', { name: 'New playlist' })).toBeInTheDocument()
    expect(sidebarPlaylists()).not.toContain('Kadhal mix')

    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New playlist' })).not.toBeInTheDocument()
    )
    expect(sidebarPlaylists()).toContain('Kadhal mix')
  })
})
