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
 * old `key === 'Enter'` handlers then acted on the half-composed text: they ran
 * a search, saved a playlist or an EQ preset under it, or ran whichever
 * command-palette row was highlighted. These tests pin every text input that
 * acts on Enter.
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
    // Views are lazy-loaded, so the request can trail the keypress on a slow machine.
    await waitFor(() => expect(searched()).toBe(true), { timeout: 3000 })
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

describe('Enter in the custom EQ preset name', () => {
  it('does not save while an IME confirms a word, and saves on a real Enter', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText(/Featured playlist/i)

    await user.click(screen.getByRole('button', { name: 'Open Studio EQ' }))
    const dialog = screen.getByRole('dialog', { name: 'Studio Audio Equalizer and DSP' })
    const input = within(dialog).getByLabelText('Custom preset name')
    fireEvent.change(input, { target: { value: 'Kuthu bass' } })
    const presets = () => within(dialog).getByRole('group', { name: 'Equalizer presets' })

    for (const [, init] of COMPOSING) fireEvent.keyDown(input, init)
    expect(within(presets()).queryByRole('button', { name: 'Kuthu bass' })).not.toBeInTheDocument()
    expect(input).toHaveValue('Kuthu bass')

    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 })
    expect(await within(presets()).findByRole('button', { name: 'Kuthu bass' })).toBeInTheDocument()
    expect(input).toHaveValue('')
  })
})

describe('Enter in the command palette', () => {
  it('does not run the highlighted command while an IME confirms a word, and runs it on a real Enter', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText(/Featured playlist/i)

    await user.click(screen.getByRole('button', { name: 'Open command palette' }))
    const palette = () => screen.queryByRole('dialog', { name: 'Command palette' })
    const input = within(palette()).getByLabelText('Type a command or search query')
    // A query no other test uses: searches are cached, so a repeat would make no request.
    fireEvent.change(input, { target: { value: 'cmdprobe' } })
    // With a query typed, the highlighted first row is “Search cmdprobe”.
    expect(within(palette()).getAllByRole('option')[0]).toHaveTextContent('cmdprobe')
    const searched = () => fetchMock.mock.calls.some(([url]) => String(url).includes('cmdprobe'))

    for (const [, init] of COMPOSING) fireEvent.keyDown(input, init)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(palette()).toBeInTheDocument()
    expect(searched()).toBe(false)

    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 })
    await waitFor(() => expect(palette()).not.toBeInTheDocument())
    await waitFor(() => expect(searched()).toBe(true), { timeout: 3000 })
  })
})
