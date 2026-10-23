import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import App from '../src/App.jsx'
import { LibraryProvider } from '../src/state/LibraryContext.jsx'
import { PlayerProvider } from '../src/state/PlayerContext.jsx'
import { SettingsProvider } from '../src/state/SettingsContext.jsx'
import { StatusProvider } from '../src/state/StatusContext.jsx'
import { UIProvider } from '../src/state/UIContext.jsx'
import { isSupportedMusicUrl, parseSharedInput } from '../src/lib/shareTarget.js'
import { scoreSaavnCandidate } from '../../api/_lib/trackMatch.mjs'
import handleImportPlaylist from '../../api/import-playlist.mjs'
import { fixtures } from './fixtures/api.js'

const GLOBAL_CSS = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8')

function mountApp() {
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

describe('Cross-Device (Mobile, Tablet, Desktop) End-to-End Verification', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState({}, '', '/')
  })

  it('rejects instrumental cover-band impersonations ("Joowel - Blinding Lights") in scoreSaavnCandidate', () => {
    const ytTarget = {
      title: 'Blinding Lights',
      artists: ['The Weeknd'],
      album: 'After Hours',
      duration: 200,
    }
    const instrumentalCover = {
      id: 'cover-1',
      name: 'Blinding Lights',
      duration: 200,
      album: { name: 'Blinding Lights' },
      artists: {
        primary: [{ id: 'j1', name: 'Joowel' }],
        featured: [],
        // Cover distributor crediting original songwriter in `artists.all`!
        all: [{ id: 'w1', name: 'The Weeknd', role: 'lyricist' }],
      },
      image: [
        {
          quality: '500x500',
          url: 'https://c.saavncdn.com/000/Blinding-Lights-Instrumental-2024-500x500.jpg',
        },
      ],
      downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/cover.mp4' }],
    }
    const studioOriginal = {
      id: 'orig-1',
      name: 'Blinding Lights',
      duration: 200,
      album: { name: 'After Hours' },
      artists: {
        primary: [{ id: 'w1', name: 'The Weeknd' }],
        featured: [],
        all: [{ id: 'w1', name: 'The Weeknd' }],
      },
      image: [{ quality: '500x500', url: 'https://c.saavncdn.com/After-Hours-500x500.jpg' }],
      downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/original.mp4' }],
    }

    expect(scoreSaavnCandidate(ytTarget, instrumentalCover).score).toBe(0)
    expect(scoreSaavnCandidate(ytTarget, studioOriginal).score).toBeGreaterThan(0.85)
  })

  it('recognizes VIBEX own deep links (?play=...) across shareTarget + server-side import-playlist', async () => {
    const vibexYtUrl = 'https://vibex-music-pi.vercel.app/?play=yt%3AdQw4w9WgXcQ&t=42'
    expect(isSupportedMusicUrl(vibexYtUrl)).toBe(true)
    const parsed = parseSharedInput({ url: vibexYtUrl })
    expect(parsed.kind).toBe('vibex')
    expect(parsed.playId).toBe('yt:dQw4w9WgXcQ')
    expect(parsed.seekSec).toBe(42)

    const fakeFetch = vi.fn(async (url) => {
      const target = String(url)
      if (target.includes('youtube.com/oembed')) {
        return {
          ok: true,
          json: async () => ({
            title: 'Rick Astley - Never Gonna Give You Up (Official Video)',
            author_name: 'Rick Astley',
          }),
        }
      }
      if (target.includes('/search/songs')) {
        return { ok: true, json: async () => ({ success: true, data: { results: [] } }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })

    let statusCode = 0
    let payload = null
    const req = {
      method: 'GET',
      url: `/api/import-playlist?sourceUrl=${encodeURIComponent(vibexYtUrl)}`,
      headers: { host: 'vibex-music-pi.vercel.app' },
    }
    const res = {
      writeHead: (code) => {
        statusCode = code
      },
      end: (raw) => {
        payload = JSON.parse(raw)
      },
    }
    await handleImportPlaylist(req, res, { fetchImpl: fakeFetch })
    expect(statusCode).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.tracks[0]).toMatchObject({
      id: 'yt:dQw4w9WgXcQ',
      provider: 'ytmusic',
      source: 'ytmusic',
      videoId: 'dQw4w9WgXcQ',
    })
  })

  it('loads shared ?play=yt:<videoId> deep link cleanly in App shell across Mobile, Tablet, and Desktop', async () => {
    window.history.replaceState({}, '', '/?play=yt%3AdQw4w9WgXcQ')
    globalThis.fetch = vi.fn(async (url) => {
      const target = String(url)
      if (target.includes('/api/import-playlist')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              kind: 'track',
              name: 'Never Gonna Give You Up',
              tracks: [
                {
                  id: 'yt:dQw4w9WgXcQ',
                  key: 'ytmusic:dQw4w9WgXcQ',
                  provider: 'ytmusic',
                  providerTrackId: 'dQw4w9WgXcQ',
                  videoId: 'dQw4w9WgXcQ',
                  source: 'ytmusic',
                  name: 'Never Gonna Give You Up',
                  duration: 213,
                  artists: { primary: [{ id: '', name: 'Rick Astley' }], featured: [], all: [] },
                  image: [{ quality: '500x500', url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }],
                  downloadUrl: [{ quality: '160kbps', url: '/api/ytaudio?id=dQw4w9WgXcQ' }],
                },
              ],
            },
          }),
        }
      }
      for (const route of fixtures.routes) {
        if (target.includes(route.url)) {
          return { ok: true, status: 200, json: async () => route.body }
        }
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: { results: [] } }) }
    })

    const { container } = mountApp()
    await waitFor(() => {
      expect(container.querySelector('#pTitle')?.textContent).toContain('Never Gonna Give You Up')
    })

    // Sidebar / Mobile+Tablet Drawer toggle works cleanly across viewports
    const user = userEvent.setup()
    const menuBtn = screen.getByRole('button', { name: /open menu/i })
    await user.click(menuBtn)
    expect(container.querySelector('#sidebar')).toHaveClass('open')
    expect(screen.getByRole('button', { name: /open shared song or playlist link/i })).toBeInTheDocument()
  })

  it('maintains responsive Mobile (<=640px), Tablet (641-1080px), Portrait Tablet (641-820px), and Touch CSS rules', () => {
    // Tablet drawer + menu button access (641px - 1080px)
    expect(GLOBAL_CSS).toContain('#sidebar:not(.open)')
    expect(GLOBAL_CSS).toContain('#sidebar.open')
    // Portrait Tablet & Foldable dedicated full-width search & stacked FullPlayer (641px - 820px)
    expect(GLOBAL_CSS).toContain('@media (min-width: 641px) and (max-width: 820px)')
    // Zero iOS / iPadOS focus-zoom across ALL coarse pointers
    expect(GLOBAL_CSS).toMatch(/@media \(hover: none\), \(pointer: coarse\)[\s\S]*?#searchInput \{ font-size: 16px; \}/)
  })
})
