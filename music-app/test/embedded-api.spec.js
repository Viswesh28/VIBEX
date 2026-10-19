// @vitest-environment node
//
// Offline smoke test for the API the Android build embeds in-process.
//
// The 21 vendored specs under jiosaavn-api/src each dial the live
// www.jiosaavn.com, so they cannot run in CI or anywhere without egress. This
// file exercises the same code path with the network stubbed at the one seam
// that touches it — `fetch` inside src/common/helpers/fetch.helper.js — which
// proves routing, request construction, payload mapping and the DES-ECB media
// URL decryption without a single packet leaving the machine.
//
// It imports through the `jiosaavn-api` package specifier, exactly like
// src/lib/embedded-api.js does, so it also guards the `file:` dependency's
// module resolution (see the preserveSymlinks note in vite.config.js).
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { embeddedFetch } from '../src/lib/embedded-api.js'

/**
 * DES-ECB("https://aac.saavncdn.com/123/abcdef_96.mp4") under JioSaavn's
 * hard-coded key, base64'd — the exact shape `more_info.encrypted_media_url`
 * arrives in. Generated with node-forge, the same library the decryptor uses.
 */
const ENCRYPTED_MEDIA_URL = 'ID2ieOjCrwfgWvL5sXl4B1ImC5QfbsDyQd+aqn5Yzr3aGttEjbIm9m+XHLUinhCK'

const UPSTREAM_SONG = {
  id: 'abc123',
  title: 'Guzarish &amp; Co',
  type: 'song',
  year: '2010',
  language: 'hindi',
  play_count: '12345',
  explicit_content: '0',
  perma_url: 'https://www.jiosaavn.com/song/guzarish/abc123',
  image: 'https://c.saavncdn.com/123/Aashiqui-2-150x150.jpg',
  more_info: {
    duration: '262',
    has_lyrics: 'true',
    lyrics_id: 'abc123',
    album: 'Aashiqui 2',
    album_id: 'al1',
    album_url: 'https://www.jiosaavn.com/album/aashiqui-2/al1',
    label: 'T-Series',
    release_date: '2010-01-01',
    copyright_text: '(P) 2010 T-Series',
    encrypted_media_url: ENCRYPTED_MEDIA_URL,
    artistMap: {
      primary_artists: [{ id: 'a1', name: 'Arijit Singh', url: 'https://www.jiosaavn.com/artist/a1' }],
      featured_artists: [],
      artists: [{ id: 'a1', name: 'Arijit Singh', url: 'https://www.jiosaavn.com/artist/a1' }],
    },
  },
}

const upstream = (data) => ({
  ok: true,
  status: 200,
  json: async () => data,
})

let fetchSpy

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

const calledWith = () => new URL(String(fetchSpy.mock.calls.at(-1)[0]))

describe('embedded router', () => {
  it('mounts the controllers under /api, like the hosted gateway', async () => {
    fetchSpy.mockResolvedValue(upstream({ total: 1, start: 1, results: [UPSTREAM_SONG] }))
    const res = await embeddedFetch('/api/search/songs?query=guzarish&limit=1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.results).toHaveLength(1)
  })

  it('answers an unknown route with the API error envelope, not an HTML 404', async () => {
    const res = await embeddedFetch('/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ success: false, message: 'route not found' })
  })

  it('surfaces a handler error through onError rather than throwing', async () => {
    // The use case reads `data.total` without guarding, so a non-JSON upstream
    // reply (a block page, a rate limit) becomes a 500 in the envelope.
    fetchSpy.mockResolvedValue({ ok: false, status: 429, json: async () => null })
    const res = await embeddedFetch('/api/search/songs?query=x&limit=1')
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(typeof body.message).toBe('string')
  })
})

describe('upstream request construction', () => {
  it('calls JioSaavn api.php with the documented envelope params', async () => {
    fetchSpy.mockResolvedValue(upstream({ total: 0, start: 0, results: [] }))
    await embeddedFetch('/api/search/songs?query=guzarish&limit=5&page=2')

    const url = calledWith()
    expect(url.origin + url.pathname).toBe('https://www.jiosaavn.com/api.php')
    expect(url.searchParams.get('__call')).toBe('search.getResults')
    expect(url.searchParams.get('_format')).toBe('json')
    expect(url.searchParams.get('_marker')).toBe('0')
    expect(url.searchParams.get('api_version')).toBe('4')
    expect(url.searchParams.get('ctx')).toBe('web6dot0')
    expect(url.searchParams.get('q')).toBe('guzarish')
    expect(url.searchParams.get('n')).toBe('5')
    expect(url.searchParams.get('p')).toBe('2')
  })

  it('sets a real User-Agent, which a browser would silently drop', async () => {
    fetchSpy.mockResolvedValue(upstream({ total: 0, start: 0, results: [] }))
    await embeddedFetch('/api/search/songs?query=x&limit=1')

    const init = fetchSpy.mock.calls.at(-1)[1]
    expect(init.headers['User-Agent']).toMatch(/Mozilla|Chrome|Safari|Opera|Edge/i)
    expect(init.headers.Accept).toBe('application/json')
  })
})

describe('song payload mapping', () => {
  it('maps the raw JioSaavn song onto the shape the UI reads', async () => {
    fetchSpy.mockResolvedValue(upstream({ total: 1, start: 1, results: [UPSTREAM_SONG] }))
    const res = await embeddedFetch('/api/search/songs?query=guzarish&limit=1')
    const { data } = await res.json()
    const s = data.results[0]

    expect(s.id).toBe('abc123')
    expect(s.name).toBe('Guzarish &amp; Co') // entities are decoded in the UI, not here
    expect(s.duration).toBe(262) // string -> number
    expect(s.playCount).toBe(12345)
    expect(s.explicitContent).toBe(false) // '0' -> false
    expect(s.hasLyrics).toBe(true) // 'true' -> true
    expect(s.album).toEqual({
      id: 'al1',
      name: 'Aashiqui 2',
      url: 'https://www.jiosaavn.com/album/aashiqui-2/al1',
    })
    expect(s.artists.primary[0]).toMatchObject({ id: 'a1', name: 'Arijit Singh' })
  })

  it('expands the artwork into the three sizes and upgrades http to https', async () => {
    fetchSpy.mockResolvedValue(upstream({ total: 1, start: 1, results: [UPSTREAM_SONG] }))
    const { data } = await (await embeddedFetch('/api/search/songs?query=x&limit=1')).json()

    expect(data.results[0].image.map((i) => i.quality)).toEqual(['50x50', '150x150', '500x500'])
    for (const img of data.results[0].image) {
      expect(img.url.startsWith('https://')).toBe(true)
      expect(img.url).toContain(img.quality)
    }
  })

  it('decrypts the media URL into all five quality tiers', async () => {
    fetchSpy.mockResolvedValue(upstream({ total: 1, start: 1, results: [UPSTREAM_SONG] }))
    const { data } = await (await embeddedFetch('/api/search/songs?query=x&limit=1')).json()
    const links = data.results[0].downloadUrl

    expect(links.map((l) => l.quality)).toEqual(['12kbps', '48kbps', '96kbps', '160kbps', '320kbps'])
    expect(links[2].url).toBe('https://aac.saavncdn.com/123/abcdef_96.mp4')
    expect(links[4].url).toBe('https://aac.saavncdn.com/123/abcdef_320.mp4')
  })

  it('returns an empty downloadUrl list when there is no encrypted link', async () => {
    const bare = { ...UPSTREAM_SONG, more_info: { ...UPSTREAM_SONG.more_info, encrypted_media_url: undefined } }
    fetchSpy.mockResolvedValue(upstream({ total: 1, start: 1, results: [bare] }))
    const { data } = await (await embeddedFetch('/api/search/songs?query=x&limit=1')).json()
    expect(data.results[0].downloadUrl).toEqual([])
  })
})

describe('the probe the UI uses to decide "API offline"', () => {
  it('matches the exact shape probeApi() asserts on', async () => {
    fetchSpy.mockResolvedValue(upstream({ total: 1, start: 1, results: [UPSTREAM_SONG] }))
    const res = await embeddedFetch('/api/search/songs?query=test&limit=1')
    const payload = await res.json()

    // Mirrors src/lib/api.js probeApi(): all three must hold or the app shows
    // its offline screen.
    expect(res.ok).toBe(true)
    expect(payload.success).toBe(true)
    expect(Array.isArray(payload.data.results)).toBe(true)
  })
})
