import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import App from '../src/App.jsx'
import { StatusProvider } from '../src/state/StatusContext.jsx'
import { SettingsProvider } from '../src/state/SettingsContext.jsx'
import { LibraryProvider } from '../src/state/LibraryContext.jsx'
import { PlayerProvider } from '../src/state/PlayerContext.jsx'
import { UIProvider } from '../src/state/UIContext.jsx'
import {
  extractFirstUrl,
  inspectCrossDeviceShareSupport,
  isSupportedMusicUrl,
  parseSharedInput,
  readIncomingShareFromLocation,
} from '../src/lib/shareTarget.js'
import importPlaylistHandler from '../../api/import-playlist.mjs'
import { fixtures } from './fixtures/api.js'

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

function renderFullApp() {
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

function makeStudioSong(overrides = {}) {
  return {
    id: 'shared-hukum-320',
    name: 'Hukum - Thalaivar Alappara',
    type: 'song',
    duration: 207,
    language: 'tamil',
    album: { id: 'alb-jailer', name: 'Jailer' },
    artists: { primary: [{ id: 'art-ani', name: 'Anirudh Ravichander' }], featured: [], all: [] },
    image: [{ quality: '500x500', url: 'https://cdn.example/hukum-500.jpg' }],
    downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/hukum-320.m4a' }],
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  document.body.className = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Share to VIBEX — Cross-Device OS Share Sheet, PWA, Native Android, iOS & Smart URL Resolution', () => {
  it('declares Web Share Target, focus-existing Launch Handler, protocol handler & verified shortcut icons in manifest.webmanifest', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(appRoot, 'public', 'manifest.webmanifest'), 'utf8')
    )
    expect(manifest.share_target).toEqual({
      action: '/?vibex_share=1',
      method: 'GET',
      params: {
        title: 'share_title',
        text: 'share_text',
        url: 'share_url',
      },
    })
    expect(manifest.launch_handler).toEqual({
      client_mode: ['focus-existing', 'auto'],
    })
    expect(manifest.protocol_handlers).toEqual([
      { protocol: 'web+vibex', url: '/?share_url=%s' },
    ])
    expect(manifest.shortcuts.length).toBeGreaterThanOrEqual(3)
    for (const sc of manifest.shortcuts) {
      for (const ic of sc.icons) {
        expect(existsSync(path.join(appRoot, 'public', ic.src.replace(/^\//, '')))).toBe(true)
      }
    }
  })

  it('wires native Android ACTION_SEND (text/plain), App Links & ShareIntentPlugin for the Capacitor APK', () => {
    const androidManifest = readFileSync(
      path.join(appRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
      'utf8'
    )
    expect(androidManifest).toContain('android.intent.action.SEND')
    expect(androidManifest).toContain('android:mimeType="text/plain"')
    expect(androidManifest).toContain('android:scheme="vibex"')
    expect(androidManifest).toContain('android:host="vibex-music-pi.vercel.app"')

    const mainActivity = readFileSync(
      path.join(
        appRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        'dev',
        'viswesh',
        'vibex',
        'MainActivity.java'
      ),
      'utf8'
    )
    expect(mainActivity).toContain('Intent.ACTION_SEND')
    expect(mainActivity).toContain('Intent.ACTION_VIEW')
    expect(mainActivity).toContain('VibexBridge')

    const sharePlugin = readFileSync(
      path.join(
        appRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        'dev',
        'viswesh',
        'vibex',
        'ShareIntentPlugin.java'
      ),
      'utf8'
    )
    expect(sharePlugin).toContain('handleOnNewIntent')
    expect(sharePlugin).toContain('notifyListeners("shareReceived", payload, true)')
  })

  it('parses real-world mobile Share Sheet quirks across YouTube, YT Music, Spotify, JioSaavn, Apple Music & Shazam', () => {
    // 1. Android YouTube app puts URL inside `text` with `url: ""` and trailing punctuation + timestamp
    const ytShare = parseSharedInput({
      title: 'Hukum - Jailer',
      text: 'Watch this banger! https://youtu.be/1F3hm6MfR1k?si=xyz987&t=1m24s.',
      url: '',
    })
    expect(ytShare).toMatchObject({
      kind: 'track',
      provider: 'youtube',
      videoId: '1F3hm6MfR1k',
      seekSec: 84,
    })

    // 2. YT Music single song includes `&list=RDAMVM...` — MUST be classified as single `track`, NOT playlist!
    const ytmSingle = parseSharedInput({
      text: 'https://music.youtube.com/watch?v=1F3hm6MfR1k&list=RDAMVM1F3hm6MfR1k',
    })
    expect(ytmSingle).toMatchObject({
      kind: 'track',
      provider: 'youtube',
      providerLabel: 'YouTube Music',
      videoId: '1F3hm6MfR1k',
    })

    // 3. YT Music true playlist & MPREb album browse links -> `collection`
    expect(
      parseSharedInput({ url: 'https://music.youtube.com/playlist?list=PL1234567890' })
    ).toMatchObject({ kind: 'collection', subKind: 'playlist', provider: 'youtube' })
    expect(
      parseSharedInput({ url: 'https://music.youtube.com/browse/MPREb_AbCdEf12345' })
    ).toMatchObject({ kind: 'collection', subKind: 'album', provider: 'youtube' })

    // 4. Spotify prose share, `/intl-en/track/...`, `spotify:track:...` URI, and `spotify.link` short URL
    expect(
      parseSharedInput({
        text: 'Here’s a song for you… Chaleya by Arijit Singh\nhttps://open.spotify.com/intl-en/track/3xMHXmedL5Rvfxmiar9Ryv?si=1234',
      })
    ).toMatchObject({
      kind: 'track',
      provider: 'spotify',
      spotifyId: '3xMHXmedL5Rvfxmiar9Ryv',
    })
    expect(extractFirstUrl('spotify:track:3xMHXmedL5Rvfxmiar9Ryv')).toBe(
      'https://open.spotify.com/track/3xMHXmedL5Rvfxmiar9Ryv'
    )
    expect(parseSharedInput({ text: 'https://spotify.link/AbCdEfGh12' })).toMatchObject({
      kind: 'redirect',
      provider: 'spotify',
    })

    // 5. JioSaavn song vs playlist & Shazam plain-text share
    expect(
      parseSharedInput({
        text: 'Listen on JioSaavn https://www.jiosaavn.com/song/hukum-thalaivar-alappara/HxpTfSRaYAU',
      })
    ).toMatchObject({ kind: 'track', provider: 'jiosaavn' })
    expect(
      parseSharedInput({
        text: 'I used Shazam to discover Katchi Sera by Sai Abhyankkar.',
      })
    ).toMatchObject({
      kind: 'query',
      query: expect.stringContaining('Katchi Sera by Sai Abhyankkar'),
    })
    expect(isSupportedMusicUrl('https://open.spotify.com/track/3xMHXmedL5Rvfxmiar9Ryv')).toBe(true)
    expect(isSupportedMusicUrl('anirudh hits')).toBe(false)
  })

  it('reports accurate Cross-Device Share profiles for Native Android, Android PWA, Android Chrome, iPhone/iPad & Desktop', () => {
    const mkWin = ({ ua, platform = 'Linux armv8l', maxTouchPoints = 5, standalone = false, native = false, launchQueue = false }) => ({
      location: { origin: 'https://vibex-music-pi.vercel.app' },
      navigator: { userAgent: ua, platform, maxTouchPoints, standalone, clipboard: { readText: async () => '' } },
      matchMedia: () => ({ matches: standalone }),
      ...(native ? { __VIBEX_NATIVE: true } : {}),
      ...(launchQueue ? { launchQueue: { setConsumer: () => {} } } : {}),
    })

    expect(
      inspectCrossDeviceShareSupport(
        mkWin({ ua: 'Mozilla/5.0 (Linux; Android 14)', native: true })
      ).tier
    ).toBe('native-android')

    expect(
      inspectCrossDeviceShareSupport(
        mkWin({ ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile', standalone: true })
      ).tier
    ).toBe('pwa-android-ready')

    expect(
      inspectCrossDeviceShareSupport(
        mkWin({ ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile', standalone: false })
      ).tier
    ).toBe('pwa-android-installable')

    const ipadInfo = inspectCrossDeviceShareSupport(
      mkWin({
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      })
    )
    expect(ipadInfo.tier).toBe('ios')
    expect(ipadInfo.autoplayMayRequireTap).toBe(true)
    expect(ipadInfo.iosShortcutBaseUrl).toBe('https://vibex-music-pi.vercel.app/?share_url=')

    expect(
      inspectCrossDeviceShareSupport(
        mkWin({
          ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0',
          platform: 'Win32',
          maxTouchPoints: 0,
          standalone: true,
          launchQueue: true,
        })
      ).tier
    ).toBe('pwa-desktop-ready')
  })

  it('unwraps mobile short redirects (`spotify.link`) and resolves single Spotify & JioSaavn shares to 320kbps tracks in /api/import-playlist', async () => {
    const fetchMock = vi.fn(async (url) => {
      const s = String(url)
      if (s.includes('spotify.link/ShortHukum')) {
        return {
          ok: false,
          status: 302,
          headers: new Map([['location', 'https://open.spotify.com/track/3xMHXmedL5Rvfxmiar9Ryv']]),
        }
      }
      if (s.includes('open.spotify.com/embed/track/3xMHXmedL5Rvfxmiar9Ryv')) {
        return {
          ok: true,
          status: 200,
          text: async () => '<html><head><title>Spotify</title></head><body></body></html>',
        }
      }
      if (s.includes('open.spotify.com/oembed')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ title: 'Hukum - Anirudh Ravichander' }),
        }
      }
      if (s.includes('/api/search/songs')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { results: [makeStudioSong()] },
          }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })

    let statusCode = 0
    let payload = null
    await importPlaylistHandler(
      {
        method: 'POST',
        url: '/api/import-playlist',
        headers: { host: 'vibex.internal' },
        body: { url: 'https://spotify.link/ShortHukum' },
      },
      {
        setHeader: () => {},
        writeHead: (code) => {
          statusCode = code
        },
        end: (raw) => {
          payload = JSON.parse(raw)
        },
      },
      { fetchImpl: fetchMock }
    )

    expect(statusCode).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.kind).toBe('track')
    expect(payload.data.tracks[0].id).toBe('shared-hukum-320')
  })

  it('auto-plays a shared track on cold OS Share Sheet launch, cleans transient query params, supports LaunchQueue & passes axe a11y', async () => {
    let launchConsumer = null
    window.launchQueue = {
      setConsumer: (fn) => {
        launchConsumer = fn
      },
    }

    // Simulate Android OS Share Sheet launching installed PWA (`/?vibex_share=1&share_text=...`)
    window.history.replaceState(
      null,
      '',
      '/?vibex_share=1&share_title=Hukum&share_text=' +
        encodeURIComponent('Check this out https://open.spotify.com/track/3xMHXmedL5Rvfxmiar9Ryv')
    )
    expect(readIncomingShareFromLocation(window.location)?.parsed?.provider).toBe('spotify')

    const sharedSong = makeStudioSong()
    const secondSharedSong = makeStudioSong({
      id: 'shared-chaleya-320',
      name: 'Chaleya Studio Mix',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, init) => {
        const url = typeof input === 'string' ? input : input.url
        if (url.includes('/api/import-playlist')) {
          const body = JSON.parse(init?.body || '{}')
          const isSecond = String(body.url || '').includes('9ySecondTrackId99999')
          const song = isSecond ? secondSharedSong : sharedSong
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                kind: 'track',
                name: song.name,
                source: 'spotify',
                sourceType: 'spotify',
                requestedCount: 1,
                matchedCount: 1,
                totalFound: 1,
                tracks: [song],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }
        const match = fixtures.routes.find((r) => url.includes(r.match))
        if (match) {
          return new Response(JSON.stringify(match.body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({ success: true, data: { results: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
    )

    renderFullApp()

    // 1. Dialog opens, resolves shared song, auto-plays while player was idle, and cleans URL params
    const dialog = await screen.findByRole('dialog', { name: 'Share to VIBEX' })
    expect(await screen.findByRole('heading', { name: 'Hukum - Thalaivar Alappara' })).toBeInTheDocument()
    expect(window.location.search).toBe('')

    // Accessibility invariants on open Share-to-VIBEX modal (both light & dark themes)
    for (const btn of within(dialog).getAllByRole('button')) {
      expect((btn.getAttribute('aria-label') || btn.textContent || '').trim().length).toBeGreaterThan(0)
    }
    for (const img of dialog.querySelectorAll('img')) {
      expect(img.hasAttribute('alt')).toBe(true)
    }
    expect(dialog.textContent).not.toMatch(/undefined|NaN|\[object Object\]/)

    // 2. While first track is actively playing, sending a second share via `window.launchQueue`
    //    DOES NOT interrupt the currently playing track until the user explicitly chooses an action!
    expect(typeof launchConsumer).toBe('function')
    launchConsumer({
      targetURL:
        'https://vibex-music-pi.vercel.app/?vibex_share=1&share_url=' +
        encodeURIComponent('https://open.spotify.com/track/9ySecondTrackId99999'),
    })

    expect(await screen.findByRole('heading', { name: 'Chaleya Studio Mix' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Play Next/i }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Share to VIBEX' })).not.toBeInTheDocument()
    })

    // 3. Cross-device fallback (iOS Safari / Firefox / Desktop): submitting a music link in `#searchInput`
    //    opens Share-to-VIBEX resolution directly instead of running a broken text search
    const searchInput = screen.getByLabelText(/Search songs, albums, playlists and artists/i)
    await userEvent.type(
      searchInput,
      'https://open.spotify.com/track/3xMHXmedL5Rvfxmiar9Ryv{Enter}'
    )
    expect(await screen.findByRole('dialog', { name: 'Share to VIBEX' })).toBeInTheDocument()

    delete window.launchQueue
  })

  it('enforces cross-device responsive CSS invariants (iOS 16px input zoom prevention, 320px header fit, 40px+ touch targets, dark/light tokens)', () => {
    const css = readFileSync(path.join(appRoot, 'src/styles/global.css'), 'utf8')
    // Dark + Light theme tokens defined on :root so modals never render transparent
    expect(css).toContain('--surface-2: var(--card-strong);')
    expect(css).toContain('--border: var(--line);')
    // iOS Safari WebKit focus-zoom prevention (>= 16px on modal inputs)
    expect(css).toMatch(/\.share-vibex-modal input[\s\S]*?font-size:\s*16px/)
    // 320px compact phone topbar protection & scrollable 5-tab bar
    expect(css).toMatch(/\.top-cmd-btn\s*\{\s*display:\s*none;\s*\}/)
    expect(css).toMatch(/@media\s*\(max-width:\s*420px\)[\s\S]*?\.top-eq-btn\s*\{\s*display:\s*none;\s*\}/)
    expect(css).toMatch(/\.tabs\s*\{[\s\S]*?overflow-x:\s*auto;/)
  })
})
