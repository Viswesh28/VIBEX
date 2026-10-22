import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeedView } from '../src/components/FeedView.jsx'
import { SettingsProvider } from '../src/state/SettingsContext.jsx'
import { StatusProvider } from '../src/state/StatusContext.jsx'
import { UIProvider } from '../src/state/UIContext.jsx'
import { clear, recent } from '../src/lib/telemetry.js'
import { fixtures } from './fixtures/api.js'

/**
 * The home screen's contract, as the research spells it out:
 *
 *   - a shelf is a unit, and one failing shelf must not blank the page
 *   - placeholder cards reserve their height while loading
 *   - a first-page failure gets a bounded, jittered retry
 *   - every degrade is reported, because silent degradation is invisible
 */
const playlists = fixtures.routes.find((r) => r.pattern.includes('search/playlists')).body

const respond = (body, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body })

function mount() {
  return render(
    <SettingsProvider>
      <StatusProvider>
        <UIProvider>
          <FeedView />
        </UIProvider>
      </StatusProvider>
    </SettingsProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('home feed', () => {
  it('reserves fixed-height shelves before the data lands', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { container } = mount()
    expect(container.querySelectorAll('.skeleton-shelf').length).toBeGreaterThan(0)
    expect(container.querySelector('.skeleton-hero')).not.toBeNull()
  })

  it('renders the shelves once they load', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(playlists)))
    mount()
    await waitFor(() => expect(screen.getByText('Tamil Trending')).toBeInTheDocument())
    expect(screen.getAllByRole('region').length).toBeGreaterThan(0)
  })

  it('drops a failed shelf instead of blanking the page, and reports it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (String(url).includes('bollywood')) return respond({ success: false }, false)
        return respond(playlists)
      })
    )
    mount()
    await waitFor(() => expect(screen.getByText(/didn't load/i)).toBeInTheDocument())
    expect(screen.getByText('Tamil Trending')).toBeInTheDocument()
    const degraded = recent(20).find((e) => e.event === 'home.degraded')
    expect(degraded).toBeTruthy()
    expect(degraded.sections).toContain('Bollywood Hits')
  })

  it('offers a retry when every shelf fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ success: false }, false)))
    mount()
    await waitFor(() => expect(screen.getByText('Feed unavailable')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(recent(20).some((e) => e.event === 'home.failed')).toBe(true)
  })

  it('retries a total failure once data returns', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        calls += 1
        // The first pass fails outright; the retry succeeds.
        return calls <= 4 ? respond({ success: false }, false) : respond(playlists)
      })
    )
    mount()
    await waitFor(() => expect(screen.getByText('Feed unavailable')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(screen.getByText('Tamil Trending')).toBeInTheDocument(), {
      timeout: 4000,
    })
  })
})
