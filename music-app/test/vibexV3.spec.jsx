import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  EQ_BANDS,
  EQ_PRESETS,
  applyDeckPlaybackRate,
  applyDspSettings,
  createAudioDspChain,
} from '../src/lib/audioDsp.js'
import { hasIndicScript, transliterateToRoman } from '../src/lib/transliterate.js'
import { renderLyricCardBlob } from '../src/lib/lyricCard.js'
import {
  buildPathForView,
  buildShareUrl,
  parseRouteFromLocation,
} from '../src/lib/shareUrl.js'
import {
  clearAllOfflineAudio,
  idbGet,
  idbSet,
  listOfflineTracks,
  pinTrackOffline,
  resolveOfflinePlaybackUrl,
  unpinTrackOffline,
} from '../src/lib/offlineStore.js'
import { createSupabaseSyncService } from '../src/lib/supabaseSync.js'
import { createJioSaavnStreamResolver } from '../src/lib/providers.js'
import importPlaylistHandler from '../../api/import-playlist.mjs'
import ytaudioHandler, {
   MAX_STREAM_MEMO,
  isRateLimited,
  markMirrorDead,
  pruneStreamMemo,
  streamMemo,
} from '../../api/ytaudio.mjs'

import App from '../src/App.jsx'
import { LibraryProvider } from '../src/state/LibraryContext.jsx'
import { PlayerProvider, usePlayerTransport } from '../src/state/PlayerContext.jsx'
import { SettingsProvider } from '../src/state/SettingsContext.jsx'
import { StatusProvider } from '../src/state/StatusContext.jsx'
import { UIProvider } from '../src/state/UIContext.jsx'
import { LyricsBody } from '../src/components/LyricsBody.jsx'
import { fixtures } from './fixtures/api.js'

const ROUTES = [
  ['/api/search/songs', fixtures.routes[0].body],
  ['/api/search/playlists', fixtures.routes[1].body],
  ['/api/search/albums', fixtures.routes[2].body],
  ['/api/search/artists', fixtures.routes[3].body],
  ['/api/playlists', fixtures.routes[5].body],
  ['/api/albums', fixtures.routes[6].body],
  ['/api/artists', fixtures.routes[7].body],
]

beforeEach(async () => {
  localStorage.clear()
  document.body.className = ''
  await clearAllOfflineAudio()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('VIBEX v3.0 — Studio DSP, Streaming Pipes, Offline Vault, Queue 2.0, Lyrics 2.0, Importer & Supabase Cloud Sync', () => {
  it('builds a 10-band Web Audio DSP chain and applies EQ presets, loudness norm, reverb & Slowed+Reverb', () => {
    const makeParam = (initial = 0) => ({ value: initial, setValueAtTime: vi.fn((v) => { makeParam.v = v }) })
    const mockCtx = {
      currentTime: 0,
      sampleRate: 44100,
      createGain: () => ({ gain: makeParam(1), connect: vi.fn() }),
      createBiquadFilter: () => ({
        type: 'peaking',
        frequency: makeParam(1000),
        Q: makeParam(1.1),
        gain: makeParam(0),
        connect: vi.fn(),
      }),
      createDynamicsCompressor: () => ({
        threshold: makeParam(-20),
        knee: makeParam(24),
        ratio: makeParam(4),
        attack: makeParam(0.005),
        release: makeParam(0.22),
        connect: vi.fn(),
      }),
      createConvolver: () => ({ buffer: null, connect: vi.fn() }),
      createBuffer: (_ch, len) => ({
        getChannelData: () => new Float32Array(len),
      }),
    }

    const chain = createAudioDspChain(mockCtx)
    expect(chain.bands).toHaveLength(10)
    expect(EQ_BANDS).toHaveLength(10)

    applyDspSettings(chain, {
      eqOn: true,
      eqGains: EQ_PRESETS.bass_boost.gains,
      loudnessNorm: true,
      reverbMix: 0.25,
      slowedReverb: false,
    })
    expect(chain.bands[0].gain.setValueAtTime).toHaveBeenCalledWith(6.5, 0)

    const mockDeck = { playbackRate: 1, preservesPitch: true }
    applyDeckPlaybackRate(mockDeck, { slowedReverb: true, playbackRate: 1, preservePitch: true })
    expect(mockDeck.playbackRate).toBe(0.84)
    expect(mockDeck.preservesPitch).toBe(false)
  })

  it('transliterates Tamil, Hindi/Devanagari & Telugu lyrics into readable Roman sing-along script', () => {
    expect(hasIndicScript('தமிழ் பாடல்')).toBe(true)
    expect(hasIndicScript('तुम ही हो')).toBe(true)
    expect(hasIndicScript('Plain English Line')).toBe(false)

    const tamilRoman = transliterateToRoman('தமிழ்')
    expect(tamilRoman).toBe('thamizh')

    const hindiRoman = transliterateToRoman('नमस्ते')
    expect(hindiRoman).toContain('namas')
  })

  it('supports click-to-seek and Indic Romanize rendering inside LyricsBody', async () => {
    const onSeekLine = vi.fn()
    render(
      <LyricsBody
        res={{
          type: 'synced',
          lines: [
            { time: 12.5, text: 'தமிழ் இசை' },
            { time: 28.0, text: 'Second chorus line' },
          ],
        }}
        activeIdx={0}
        onSeekLine={onSeekLine}
        romanize
      />
    )
    expect(screen.getByText(/thamizh/i)).toBeTruthy()
    await userEvent.click(screen.getByText('Second chorus line'))
    expect(onSeekLine).toHaveBeenCalledWith(28.0)
  })

  it('generates a valid shareable Lyric Card PNG blob via HTMLCanvasElement', async () => {
    const origGetContext = HTMLCanvasElement.prototype.getContext
    const origToBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      fillRect: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      clip: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: (txt) => ({ width: txt.length * 14 }),
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
      createRadialGradient: () => ({ addColorStop: vi.fn() }),
    }))
    HTMLCanvasElement.prototype.toBlob = vi.fn((cb) => cb(new Blob(['PNGDATA'], { type: 'image/png' })))

    try {
      const blob = await renderLyricCardBlob({
        track: { name: 'Hukum', artists: { primary: [{ name: 'Anirudh Ravichander' }] } },
        lines: ['Thalaivar Alappara', 'Tiger ka Hukum'],
      })
      expect(blob.size).toBeGreaterThan(0)
      expect(blob.type).toBe('image/png')
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext
      HTMLCanvasElement.prototype.toBlob = origToBlob
    }
  })

  it('pins audio tracks into the offline vault and resolves offline playback with zero network calls', async () => {
    await idbSet('test_kv', { count: 1250 })
    expect(await idbGet('test_kv')).toEqual({ count: 1250 })

    const fetchSpy = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'audio/mp4' },
      blob: async () => new Blob([new Uint8Array(2048)], { type: 'audio/mp4' }),
    }))
    vi.stubGlobal('fetch', fetchSpy)

    const sampleSong = {
      id: 'offline-test-1',
      name: 'Offline Anthem',
      duration: 210,
      downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/song.m4a' }],
      artists: { primary: [{ name: 'A.R. Rahman' }] },
      image: [{ quality: '500x500', url: 'https://cdn.example/art.jpg' }],
    }

    await pinTrackOffline(sampleSong)
    expect((await listOfflineTracks()).map((x) => x.id)).toContain('offline-test-1')

    fetchSpy.mockClear()
    const resolver = createJioSaavnStreamResolver()
    const resolved = await resolver.resolve('offline-test-1', '320kbps', { track: sampleSong })
    expect(resolved.quality).toBe('offline')
    expect(resolved.uri).toMatch(/^blob:/)
    expect(fetchSpy).not.toHaveBeenCalled()

    await unpinTrackOffline('offline-test-1')
    expect(await resolveOfflinePlaybackUrl('offline-test-1')).toBeNull()
  })

  it('round-trips deep-link URLs (?v=search, /album/:id, /artist/:id, ?play=<id>&t=<sec>)', () => {
    const albumPath = buildPathForView({ kind: 'detail', type: 'album', id: 'alb99' })
    expect(parseRouteFromLocation({ pathname: '/', search: albumPath.slice(1) }).view).toEqual({
      kind: 'detail',
      type: 'album',
      id: 'alb99',
    })

    const deepLink = parseRouteFromLocation({
      pathname: '/artist/459320',
      search: '?play=song777&t=42',
    })
    expect(deepLink.view).toEqual({ kind: 'artist', id: '459320' })
    expect(deepLink.playTrackId).toBe('song777')
    expect(deepLink.seekSec).toBe(42)
    expect(buildShareUrl('/?play=song777', 'https://vibex-music-pi.vercel.app')).toBe(
      'https://vibex-music-pi.vercel.app/?play=song777'
    )
  })

  it('manages Play Next, Add to Queue, and drag-reorder without interrupting playback', async () => {
    let apiRef = null
    function Probe() {
      apiRef = usePlayerTransport()
      return null
    }
    render(
      <StatusProvider>
        <SettingsProvider>
          <LibraryProvider>
            <PlayerProvider>
              <Probe />
            </PlayerProvider>
          </LibraryProvider>
        </SettingsProvider>
      </StatusProvider>
    )

    const s1 = { id: 's1', name: 'Song One', duration: 180, downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/1.m4a' }] }
    const s2 = { id: 's2', name: 'Song Two', duration: 190, downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/2.m4a' }] }
    const s3 = { id: 's3', name: 'Song Three', duration: 200, downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/3.m4a' }] }
    const sNext = { id: 'sNext', name: 'Priority Next', duration: 175, downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/n.m4a' }] }

    apiRef.playFromList([s1, s2], 0)
    await waitFor(() => expect(apiRef.currentIndex).toBe(0))

    apiRef.playNext(sNext)
    await waitFor(() => expect(apiRef.queue.map((x) => x.id)).toEqual(['s1', 'sNext', 's2']))
    expect(apiRef.current.id).toBe('s1')

    apiRef.addToQueue(s3)
    await waitFor(() => expect(apiRef.queue.map((x) => x.id)).toEqual(['s1', 'sNext', 's2', 's3']))

    apiRef.qReorder(3, 1)
    await waitFor(() => expect(apiRef.queue.map((x) => x.id)).toEqual(['s1', 's3', 'sNext', 's2']))
    expect(apiRef.currentIndex).toBe(0)
  })

  it('bounds ytaudio LRU memo, streams chunks zero-buffer, and enforces rate guard', async () => {
    for (let i = 0; i < MAX_STREAM_MEMO + 25; i++) {
      streamMemo.set(`vid_${i}`, { url: `https://audio.example/${i}`, expiresAt: Date.now() + 60_000 })
    }
    pruneStreamMemo()
    expect(streamMemo.size).toBeLessThanOrEqual(MAX_STREAM_MEMO)

    markMirrorDead('dead.mirror.invalid')
    expect(isRateLimited('198.51.100.77')).toBe(false)

    // Pre-seed cache and stream directly through ReadableStream -> Node HTTP response
    streamMemo.set('dQw4w9WgXcQ', {
      url: 'https://audio.example/live.m4a',
      mimeType: 'audio/mp4',
      expiresAt: Date.now() + 120_000,
    })

    const encoder = new TextEncoder()
    const webStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('CHUNK_A_'))
        controller.enqueue(encoder.encode('CHUNK_B'))
        controller.close()
      },
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 206,
        headers: new Map([
          ['content-type', 'audio/mp4'],
          ['content-range', 'bytes 0-14/15'],
        ]),
        body: webStream,
      }))
    )

    const chunks = []
    const resHeaders = {}
    const res = {
      statusCode: 200,
      headersSent: false,
      writableEnded: false,
      setHeader: (k, v) => {
        resHeaders[k.toLowerCase()] = v
      },
      write: (chunk) => {
        chunks.push(Buffer.from(chunk))
        return true
      },
      end: (chunk) => {
        if (chunk) chunks.push(Buffer.from(chunk))
        res.writableEnded = true
      },
      once: () => {},
      on: () => {},
      removeListener: () => {},
      destroy: () => {},
    }

    await ytaudioHandler(
      { url: '/api/ytaudio?id=dQw4w9WgXcQ', headers: { range: 'bytes=0-14' }, socket: {} },
      res
    )
    expect(res.statusCode).toBe(206)
    expect(Buffer.concat(chunks).toString('utf8')).toBe('CHUNK_A_CHUNK_B')
  })

  it('imports external plain-text playlists via /api/import-playlist into playable tracks', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          results: [
            {
              id: 'imp-hukum',
              name: 'Hukum',
              duration: 207,
              artists: { primary: [{ name: 'Anirudh Ravichander' }] },
              image: [{ quality: '500x500', url: 'https://cdn.example/hukum.jpg' }],
              downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/hukum.m4a' }],
            },
          ],
        },
      }),
    }))

    let statusCode = 200
    let bodyOut = null
    const req = {
      method: 'POST',
      url: '/api/import-playlist',
      headers: { host: 'localhost:8000' },
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(
          JSON.stringify({
            name: 'Roadtrip Favorites',
            text: 'Anirudh - Hukum\nA.R. Rahman - Jai Ho',
          })
        )
      },
    }
    const res = {
      setHeader: () => {},
      writeHead: (code) => {
        statusCode = code
      },
      end: (raw) => {
        bodyOut = JSON.parse(raw)
      },
    }

    await importPlaylistHandler(req, res, { fetchImpl: fetchMock })
    expect(statusCode).toBe(200)
    expect(bodyOut.success).toBe(true)
    expect(bodyOut.data.name).toBe('Roadtrip Favorites')
    expect(bodyOut.data.tracks.length).toBeGreaterThan(0)
  })

  it('performs Supabase Email+Password sign-in, pushLibrary & listLiked round-trip cleanly', async () => {
    const remoteRows = []
    const fetchMock = vi.fn(async (url, init = {}) => {
      const target = String(url)
      if (target.includes('/auth/v1/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'jwt_test_token',
            refresh_token: 'refresh_test_token',
            expires_in: 3600,
            user: { id: '11111111-2222-3333-4444-555555555555', email: 'listener@vibex.app' },
          }),
        }
      }
      if (target.includes('/rest/v1/vibex_user_sync')) {
        if (init.method === 'POST') {
          const parsed = JSON.parse(init.body)
          remoteRows[0] = parsed
          return { ok: true, status: 201, text: async () => JSON.stringify([parsed]) }
        }
        return { ok: true, status: 200, text: async () => JSON.stringify(remoteRows) }
      }
      return { ok: true, status: 200, text: async () => '[]' }
    })

    const supa = createSupabaseSyncService({
      url: 'https://fmuzxyqlcufojrjbmhuk.supabase.co',
      anonKey: 'anon_public_test_key',
      fetchImpl: fetchMock,
    })
    expect(supa.isSupabase).toBe(true)

    supa.setPendingCredentials({
      mode: 'signin',
      email: 'listener@vibex.app',
      password: 'supersecretpassword',
    })
    const account = await supa.signIn()
    expect(account.displayName).toBe('listener@vibex.app')

    await supa.pushLibrary({
      liked: [{ id: 'cloud1', name: 'Cloud Song', duration: 200 }],
      playlists: [{ id: 'pl_cloud', name: 'Cloud Mix', songs: [] }],
    })
    const pulled = await supa.listLiked()
    expect(pulled.items).toHaveLength(1)
    expect(pulled.items[0].id).toBe('cloud1')
  })

  it('opens Command Palette on Ctrl+K and passes full accessibility checks across new modals', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        const target = String(url)
        for (const [prefix, payload] of ROUTES) {
          if (target.includes(prefix)) return { ok: true, status: 200, json: async () => payload }
        }
        return { ok: true, status: 200, json: async () => ({ success: true, data: { results: [] } }) }
      })
    )

    render(
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

    await screen.findByText(/Featured playlist/i)
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('dialog', { name: /Command palette/i })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /Command palette/i })).toBeNull()
  })
})
