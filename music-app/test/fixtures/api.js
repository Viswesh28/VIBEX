/**
 * Canned JioSaavn API responses, shared by the browser verification scripts
 * (mobile-verify.mjs, ux-audit.mjs).
 *
 * The layout and accessibility checks have to be deterministic: against the live
 * API a renamed playlist or an empty search would change what renders and the
 * run would fail for a reason that has nothing to do with the UI. Every /api
 * request is intercepted and answered from here, so a run means the same thing
 * today and in a year — and it works with no network egress at all.
 *
 * Shapes mirror what the real API returns after the vendored wrapper maps it
 * (see jiosaavn-api/src/modules/songs/helpers/song.helper.js).
 */

const img = (seed) => [
  { quality: '50x50', url: `https://placehold.co/50x50/222/eee?text=${seed}` },
  { quality: '150x150', url: `https://placehold.co/150x150/222/eee?text=${seed}` },
  { quality: '500x500', url: `https://placehold.co/500x500/222/eee?text=${seed}` },
]

const artist = (id, name) => ({
  id,
  name,
  url: `https://www.jiosaavn.com/artist/${id}`,
  image: img(id),
  type: 'artist',
  role: 'singer',
})

const song = (i) => ({
  id: `song${i}`,
  name: i % 4 === 0 ? `Track &amp; Field No. ${i}` : `Verification Track ${i}`,
  type: 'song',
  year: '2021',
  duration: 180 + i,
  label: 'Test Label',
  explicitContent: false,
  playCount: 10000 + i,
  language: 'tamil',
  hasLyrics: true,
  lyricsId: `song${i}`,
  url: `https://www.jiosaavn.com/song/track/${i}`,
  copyright: '(P) 2021 Test Label',
  album: { id: `al${i % 3}`, name: `Verification Album ${i % 3}`, url: `https://www.jiosaavn.com/album/al${i % 3}` },
  artists: {
    primary: [artist(`a${i % 3}`, `Verification Artist ${i % 3}`)],
    featured: [],
    all: [artist(`a${i % 3}`, `Verification Artist ${i % 3}`)],
  },
  image: img(`s${i}`),
  // Unreachable on purpose: the checks never need real audio, and a stream that
  // 404s keeps the run honest about what it did and did not exercise.
  downloadUrl: ['12kbps', '48kbps', '96kbps', '160kbps', '320kbps'].map((quality) => ({
    quality,
    url: `https://aac.saavncdn.com/fixture/track${i}_${quality.replace('kbps', '')}.mp4`,
  })),
})

const songs = Array.from({ length: 12 }, (_, i) => song(i + 1))

const playlist = (i) => ({
  id: `pl${i}`,
  name: `Verification Playlist ${i}`,
  type: 'playlist',
  description: 'Fixture playlist for layout verification.',
  url: `https://www.jiosaavn.com/playlist/pl${i}`,
  songCount: '12',
  language: 'tamil',
  year: '2021',
  followers: '1234',
  lastUpdated: '2021-01-01',
  image: img(`p${i}`),
})

const album = (i) => ({
  id: `al${i}`,
  name: `Verification Album ${i}`,
  type: 'album',
  year: '2021',
  language: 'tamil',
  url: `https://www.jiosaavn.com/album/al${i}`,
  image: img(`a${i}`),
  artists: { primary: [artist(`a${i}`, `Verification Artist ${i}`)], featured: [] },
})

const songsPayload = (n = 12) => ({
  total: n,
  start: 1,
  results: songs.slice(0, n),
})

const listPayload = (items) => ({ total: items.length, start: 1, results: items })

export const fixtures = {
  /** Route table, longest prefix first. Playwright matches in order. */
  routes: [
    {
      pattern: '**/api/search/songs**',
      body: { success: true, data: songsPayload() },
    },
    {
      pattern: '**/api/search/playlists**',
      body: { success: true, data: listPayload([1, 2, 3, 4, 5, 6].map(playlist)) },
    },
    {
      pattern: '**/api/search/albums**',
      body: { success: true, data: listPayload([1, 2, 3].map(album)) },
    },
    {
      pattern: '**/api/search/artists**',
      body: { success: true, data: listPayload([0, 1, 2].map((i) => artist(`a${i}`, `Verification Artist ${i}`))) },
    },
    {
      pattern: '**/api/search**',
      body: {
        success: true,
        data: {
          songs: songsPayload(6),
          albums: listPayload([1].map(album)),
          artists: listPayload([artist('a0', 'Verification Artist 0')]),
          playlists: listPayload([playlist(1)]),
        },
      },
    },
    {
      pattern: '**/api/playlists/**',
      body: { success: true, data: { ...playlist(1), songs } },
    },
    {
      pattern: '**/api/albums/**',
      body: { success: true, data: { ...album(1), songs } },
    },
    {
      pattern: '**/api/artists/**',
      body: {
        success: true,
        data: {
          ...artist('a0', 'Verification Artist 0'),
          followerCount: '1234567',
          topSongs: songs.slice(0, 8),
          albums: [1, 2].map(album),
        },
      },
    },
    {
      pattern: '**/api/songs/**',
      body: { success: true, data: [songs[0]] },
    },
  ],

  /** Everything else the app reaches for: artwork, audio, lyrics. */
  catchAll: {
    // A 1x1 transparent PNG, so image boxes have real dimensions.
    image: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    ),
    // Silence, so playback starts and the transport controls become live.
    audio: Buffer.from('', 'base64'),
    lyrics: [
      {
        id: 1,
        trackName: 'Verification Track 1',
        artistName: 'Verification Artist 0',
        duration: 181,
        instrumental: false,
        syncedLyrics: '[00:00.50] First line\n[00:02.00] Second line\n[00:04.00] Third line',
        plainLyrics: 'First line\nSecond line\nThird line',
      },
    ],
  },
}

/**
 * Install the fixtures on a Playwright page. Returns the log of intercepted
 * requests so a check can assert the app really did reach the API.
 */
export async function installFixtures(page) {
  const seen = []

  for (const { pattern, body } of fixtures.routes) {
    await page.route(pattern, (route) => {
      seen.push(route.request().url())
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
  }

  await page.route('**://lrclib.net/**', (route) => {
    seen.push(route.request().url())
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixtures.catchAll.lyrics),
    })
  })

  // Artwork and audio come from hosts the app is not expected to reach in a
  // sandbox; answer them locally rather than letting them hang.
  await page.route('**://placehold.co/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: fixtures.catchAll.image })
  )
  await page.route('**://*.saavncdn.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/mp4', body: fixtures.catchAll.audio })
  )
  await page.route('**://c.saavncdn.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: fixtures.catchAll.image })
  )

  return seen
}
