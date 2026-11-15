// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { findContinuationToken, parseYtSearchResponse } from '../../api/ytmusic.mjs'
import {
  compositeKey,
  createAccount,
  createPlaylist,
  createQueueEntry,
  createTrack,
  parseCompositeKey,
  redactResolvedPlayback,
  redactUrl,
  sanitizeTrackForPersistence,
  toAppSong,
  toTrackSummary,
  trackKey,
} from '../src/lib/models.js'
import { PLAYBACK_FAILURE } from '../src/lib/playbackState.js'
import {
  MetadataCache,
  createJioSaavnCatalogProvider,
  createJioSaavnStreamResolver,
  createProviderRegistry,
  createYtMusicCatalogProvider,
  createYtMusicEmbedResolver,
} from '../src/lib/providers.js'

const ytSearchFixture = {
  contents: {
    tabbedSearchResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  {
                    musicShelfRenderer: {
                      contents: [
                        {
                          musicResponsiveListItemRenderer: {
                            playlistItemData: { videoId: 'J7p4bzqLvCw' },
                            flexColumns: [
                              {
                                musicResponsiveListItemFlexColumnRenderer: {
                                  text: { runs: [{ text: 'Blinding Lights' }] },
                                },
                              },
                              {
                                musicResponsiveListItemFlexColumnRenderer: {
                                  text: {
                                    runs: [
                                      { text: 'The Weeknd' },
                                      { text: ' • ' },
                                      { text: 'After Hours' },
                                      { text: ' • ' },
                                      { text: '3:20' },
                                    ],
                                  },
                                },
                              },
                            ],
                            badges: [
                              {
                                musicInlineBadgeRenderer: {
                                  icon: { iconType: 'MUSIC_EXPLICIT_BADGE' },
                                },
                              },
                            ],
                            thumbnail: {
                              musicThumbnailRenderer: {
                                thumbnail: {
                                  thumbnails: [
                                    { url: 'https://img.example.com/small.jpg' },
                                    { url: 'https://img.example.com/large.jpg' },
                                  ],
                                },
                              },
                            },
                          },
                        },
                        // Duplicate videoId must be deduplicated
                        {
                          musicResponsiveListItemRenderer: {
                            playlistItemData: { videoId: 'J7p4bzqLvCw' },
                            flexColumns: [
                              {
                                musicResponsiveListItemFlexColumnRenderer: {
                                  text: { runs: [{ text: 'Blinding Lights Duplicate' }] },
                                },
                              },
                            ],
                          },
                        },
                      ],
                      continuations: [
                        {
                          nextContinuationData: {
                            continuation: '4qmFsgJAEhBcontinuationTokenPage2',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  },
}

describe('YouTube Music search parser fixtures', () => {
  it('parses shelf items, deduplicates videoIds, extracts explicit flag and continuation token', () => {
    const parsed = parseYtSearchResponse(ytSearchFixture, 20)
    expect(parsed.results).toHaveLength(1)
    expect(parsed.results[0]).toMatchObject({
      videoId: 'J7p4bzqLvCw',
      title: 'Blinding Lights',
      artists: ['The Weeknd'],
      album: 'After Hours',
      duration: 200,
      thumbnail: 'https://img.example.com/large.jpg',
      explicit: true,
    })
    expect(parsed.nextPageToken).toBe('4qmFsgJAEhBcontinuationTokenPage2')
    expect(findContinuationToken({})).toBeNull()
  })
})

describe('domain models, composite keys, and credential hygiene', () => {
  it('keeps identical raw IDs isolated across catalogs with composite keys', () => {
    const a = createTrack({ provider: 'jiosaavn', providerTrackId: '999111', title: 'Track A', artists: ['Artist A'] })
    const b = createTrack({ provider: 'partner_hi_fi', providerTrackId: '999111', title: 'Track B', artists: ['Artist B'] })
    const c = createTrack({ provider: 'ytmusic', providerTrackId: 'J7p4bzqLvCw', title: 'Track C', artists: ['Artist C'] })

    expect(a.key).toBe('jiosaavn:999111')
    expect(b.key).toBe('partner_hi_fi:999111')
    expect(c.key).toBe('ytmusic:J7p4bzqLvCw')
    expect(new Set([a.key, b.key, c.key]).size).toBe(3)

    expect(parseCompositeKey(b.key)).toEqual({ provider: 'partner_hi_fi', id: '999111' })
    expect(parseCompositeKey('yt:J7p4bzqLvCw')).toEqual({ provider: 'ytmusic', id: 'J7p4bzqLvCw' })
    expect(parseCompositeKey('legacySaavnId')).toEqual({ provider: 'jiosaavn', id: 'legacySaavnId' })
  })

  it('builds stable QueueEntry and Playlist records without transient playback URLs', () => {
    const appSong = toAppSong(
      toTrackSummary({
        provider: 'partner_sdk',
        providerTrackId: 'trk_42',
        title: 'Midnight Signal',
        artists: ['Nova'],
        durationMs: 245000,
        artworkUrl: 'https://cdn.example.com/cover.jpg',
        explicit: false,
      })
    )
    expect(appSong.downloadUrl).toEqual([])
    const qEntry = createQueueEntry(appSong, 3, { kind: 'playlist', id: 'pl_1' })
    expect(qEntry).toEqual({
      queueId: 'main',
      provider: 'partner_sdk',
      providerTrackId: 'trk_42',
      key: 'partner_sdk:trk_42',
      position: 3,
      sourceContext: { kind: 'playlist', id: 'pl_1' },
    })

    const pl = createPlaylist({
      provider: 'partner_sdk',
      providerPlaylistId: 'pl_1',
      title: 'Night Drive',
      syncEnabled: true,
      remoteRevision: 'rev_7',
      entries: [{ providerTrackId: 'trk_42' }],
    })
    expect(pl.entries[0].key).toBe('partner_sdk:trk_42')
  })

  it('rejects passwords, browser cookies, SAPISIDHASH, and raw bearer tokens in Account records', () => {
    expect(() =>
      createAccount({
        provider: 'partner',
        providerAccountId: 'u1',
        displayName: 'Listener',
        password: 'secretPassword',
        authStateRef: 'keychain:u1',
      })
    ).toThrow(/password/i)

    expect(() =>
      createAccount({
        provider: 'ytmusic',
        providerAccountId: 'u1',
        displayName: 'Listener',
        cookie: 'SAPISID=xyz; __Secure-3PAPISID=abc',
        authStateRef: 'keychain:u1',
      })
    ).toThrow(/cookie/i)

    expect(() =>
      createAccount({
        provider: 'ytmusic',
        providerAccountId: 'u1',
        displayName: 'Listener',
        authStateRef: 'SAPISIDHASH 1700000000_hash',
      })
    ).toThrow(/opaque secure-storage handle/i)

    const valid = createAccount({
      provider: 'partner_oauth',
      providerAccountId: 'acct_88',
      displayName: 'Aarav',
      scopes: ['library.read'],
      authStateRef: 'securestore:oauth_session_88',
    })
    expect(valid.accountId).toBe('partner_oauth:acct_88')
    expect(trackKey({ provider: 'partner_oauth', providerTrackId: '12' })).toBe('partner_oauth:12')
    expect(compositeKey('partner_oauth', 'partner_oauth:12')).toBe('partner_oauth:12')
  })

  it('redacts tokens, signatures, and request headers from logs and strips expiring URLs on save', () => {
    const rawUrl = 'https://cdn.example.com/audio.m4a?expire=1800000000&sig=SECRET_SIG&token=BEARER_TOK&itag=140'
    const redacted = redactResolvedPlayback({
      mode: 'stream',
      uri: rawUrl,
      mimeType: 'audio/mp4',
      expiresAtEpochMs: 1800000000000,
      requestHeaders: { Authorization: 'Bearer super-secret' },
      license: {
        system: 'widevine',
        licenseServerUrl: 'https://drm.example.com/wv?key=DRM_KEY',
      },
    })

    expect(redacted.uri).not.toContain('SECRET_SIG')
    expect(redacted.uri).not.toContain('BEARER_TOK')
    expect(redacted.uri).toContain('itag=140')
    expect(redacted.requestHeaders.Authorization).toBe('[REDACTED]')
    expect(redacted.license.licenseServerUrl).not.toContain('DRM_KEY')
    expect(redactUrl('https://user:pass@cdn.example.com/track.mp4?pot=PO_TOKEN')).not.toContain('pass')

    const sanitized = sanitizeTrackForPersistence({
      id: 'song_exp',
      name: 'Signed Track',
      requestHeaders: { Authorization: 'Bearer nope' },
      downloadUrl: [
        { quality: '320kbps', url: rawUrl },
      ],
    })
    expect(sanitized.downloadUrl).toEqual([])
    expect(sanitized.requestHeaders).toBeUndefined()
  })
})

describe('CatalogProvider, StreamResolver, and TTL MetadataCache', () => {
  it('caches non-sensitive metadata until TTL expiry and evicts oldest entries at capacity', async () => {
    let clock = 1000
    const cache = new MetadataCache({ ttlMs: 5000, maxEntries: 2, now: () => clock })
    const apiFn = vi.fn(async (path) => ({
      total: 45,
      results: [
        { id: `id_${path}`, name: 'Cached Song', duration: 180, artists: { primary: [{ name: 'Artist' }] } },
      ],
    }))

    const catalog = createJioSaavnCatalogProvider({ apiFn, cache })
    const first = await catalog.search('lofi', { limit: 20 })
    const second = await catalog.search('lofi', { limit: 20 })
    expect(apiFn).toHaveBeenCalledTimes(1)
    expect(first.nextPageToken).toBe('1')
    expect(second.items[0].provider).toBe('jiosaavn')

    // Advance past TTL: fresh network request runs.
    clock += 6000
    await catalog.search('lofi', { limit: 20 })
    expect(apiFn).toHaveBeenCalledTimes(2)

    // Capacity eviction check (maxEntries = 2).
    cache.set('k1', 'v1')
    cache.set('k2', 'v2')
    cache.get('k1') // refreshes k1, making k2 oldest
    cache.set('k3', 'v3')
    expect(cache.get('k2')).toBeNull()
    expect(cache.get('k1')).toBe('v1')
  })

  it('paginates YouTube Music search with continuation tokens and refuses unapproved playlists', async () => {
    const apiFn = vi.fn(async (path) => {
      if (path.includes('pageToken=tok_2')) {
        return {
          results: [{ videoId: 'vidPageTwo1', title: 'Page Two Song', artists: ['Artist 2'], duration: 210 }],
          nextPageToken: null,
        }
      }
      return {
        results: [{ videoId: 'vidPageOne1', title: 'Page One Song', artists: ['Artist 1'], duration: 195 }],
        nextPageToken: 'tok_2',
      }
    })

    const ytCatalog = createYtMusicCatalogProvider({ apiFn })
    const p1 = await ytCatalog.search('synthwave', { limit: 20 })
    expect(p1.nextPageToken).toBe('tok_2')
    expect(p1.items[0].key).toBe('ytmusic:vidPageOne1')

    const p2 = await ytCatalog.search('synthwave', { pageToken: p1.nextPageToken, limit: 20 })
    expect(p2.items[0].key).toBe('ytmusic:vidPageTwo1')
    expect(p2.nextPageToken).toBeNull()

    await expect(ytCatalog.getPlaylist('PL_UNAUTH')).rejects.toMatchObject({
      category: PLAYBACK_FAILURE.AuthorizationRequired,
    })
  })

  it('resolves fresh JioSaavn streams when persisted URLs were stripped and embeds YouTube items', async () => {
    const apiFetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: [
          {
            id: 'restored_1',
            name: 'Freshly Resolved',
            downloadUrl: [{ quality: '320kbps', url: 'https://aac.saavncdn.com/fresh_320.mp4?expire=1999999999' }],
          },
        ],
      }),
    }))

    const resolver = createJioSaavnStreamResolver({ apiFetchFn, now: () => 1700000000 * 1000 })
    const resolved = await resolver.resolve('jiosaavn:restored_1', '320kbps', {
      track: { id: 'restored_1', name: 'Freshly Resolved', downloadUrl: [] },
    })
    expect(apiFetchFn).toHaveBeenCalledTimes(1)
    expect(resolved).toMatchObject({
      mode: 'stream',
      uri: 'https://aac.saavncdn.com/fresh_320.mp4?expire=1999999999',
      expiresAtEpochMs: 1999999999 * 1000,
    })

    const ytResolver = createYtMusicEmbedResolver({ getOrigin: () => 'https://vibex.example.app' })
    const embed = await ytResolver.resolve('ytmusic:J7p4bzqLvCw', '320kbps')
    expect(embed.mode).toBe('embed')
    expect(embed.uri).toContain('youtube.com/embed/J7p4bzqLvCw')

    // Registry supports swapping in a contract-approved provider cleanly.
    const registry = createProviderRegistry({ apiFn: vi.fn(), apiFetchFn })
    registry.registerStreamResolver('licensed_partner', {
      resolve: async (id) => ({
        mode: 'stream',
        uri: `https://stream.partner.example/${id}.flac`,
        mimeType: 'audio/flac',
        expiresAtEpochMs: 1900000000000,
        requestHeaders: { Authorization: 'Bearer sdk-token' },
        license: { system: 'widevine', licenseServerUrl: 'https://drm.partner.example/license' },
      }),
    })
    const partnerPlayback = await registry
      .getStreamResolver({ provider: 'licensed_partner', id: 'licensed_partner:trk_9' })
      .resolve('trk_9', 'high')
    expect(partnerPlayback.license.system).toBe('widevine')
  })
})
