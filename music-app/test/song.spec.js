import { describe, expect, it } from 'vitest'
import {
  imgOf,
  artistsOf,
  effQ,
  streamOf,
  firstArtistId,
  estimate,
  dlBaseName,
  dlUrlFor,
} from '../src/lib/song.js'

// The four JioSaavn tiers, in the order the API returns them.
const urls = [
  { quality: '12kbps', url: 'https://cdn/12' },
  { quality: '48kbps', url: 'https://cdn/48' },
  { quality: '96kbps', url: 'https://cdn/96' },
  { quality: '320kbps', url: 'https://cdn/320' },
]

const song = {
  id: 'abc123',
  name: 'Guzarish &amp; Co',
  duration: 240,
  image: [{ url: 'https://img/50' }, { url: 'https://img/150' }, { url: 'https://img/500' }],
  artists: { primary: [{ id: 'a1', name: 'Arijit Singh' }, { id: 'a2', name: 'Mithoon' }] },
  album: { name: 'Aashiqui 2' },
  downloadUrl: urls,
}

describe('imgOf', () => {
  it('takes the largest art by default', () => {
    expect(imgOf(song)).toBe('https://img/500')
  })

  it('takes the smallest art in Data Saver mode', () => {
    expect(imgOf(song, true)).toBe('https://img/50')
  })

  it('is "" when a song has no art rather than throwing', () => {
    expect(imgOf({})).toBe('')
    expect(imgOf(null)).toBe('')
  })
})

describe('artistsOf', () => {
  it('joins primary artists', () => {
    expect(artistsOf(song)).toBe('Arijit Singh, Mithoon')
  })

  it('falls back to artists.all, then to the subtitle, then to a placeholder', () => {
    expect(artistsOf({ artists: { all: [{ name: 'Solo' }] } })).toBe('Solo')
    expect(artistsOf({ subtitle: 'From the subtitle' })).toBe('From the subtitle')
    expect(artistsOf({})).toBe('Unknown artist')
    expect(artistsOf(null)).toBe('Unknown artist')
  })
})

describe('effQ', () => {
  it('honours the preference when the API offers it', () => {
    expect(effQ(song, '160kbps')).toBe('320kbps') // not offered -> best available
    expect(effQ(song, '96kbps')).toBe('96kbps')
  })

  it('forces the lowest tier in Data Saver mode', () => {
    expect(effQ(song, '320kbps', true)).toBe('12kbps')
  })

  it('returns the preference untouched when there are no links at all', () => {
    expect(effQ({ downloadUrl: [] }, '320kbps')).toBe('320kbps')
  })
})

describe('streamOf', () => {
  it('picks the URL for the requested quality', () => {
    expect(streamOf(song, '96kbps')).toBe('https://cdn/96')
  })

  it('falls back to the best available for an unoffered quality', () => {
    expect(streamOf(song, '160kbps')).toBe('https://cdn/320')
  })

  it('is "" when there is nothing to stream', () => {
    expect(streamOf({}, '320kbps')).toBe('')
  })
})

describe('firstArtistId', () => {
  it('is the first primary artist, or null', () => {
    expect(firstArtistId(song)).toBe('a1')
    expect(firstArtistId({})).toBeNull()
  })
})

describe('estimate', () => {
  it('sizes a 320kbps track from its real duration', () => {
    // 320 kbit/s * 240 s / 8 / 1024 / 1024 = 9.155 MB
    const { perMin, songMB } = estimate('320kbps', 240)
    expect(perMin).toBeCloseTo(2.34375, 5)
    expect(songMB).toBeCloseTo(9.375, 5)
  })

  it('assumes 3 minutes and 128kbps when it has nothing to go on', () => {
    expect(estimate(undefined, undefined).songMB).toBeCloseTo(2.8125, 5)
  })
})

describe('download naming', () => {
  it('decodes entities and strips path-hostile characters', () => {
    expect(dlBaseName(song)).toBe('Arijit Singh, Mithoon - Guzarish & Co')
    // safeName deletes \ / : * ? " < > | outright rather than substituting a
    // space, so the separators simply vanish.
    expect(dlBaseName({ name: 'A/B: C*D?', artists: { primary: [{ name: 'X|Y' }] } })).toBe('XY - AB CD')
  })

  it('never yields an empty name, which would make the gateway save ".mp3"', () => {
    // A name made only of illegal characters collapses to "song", and a song
    // with no usable artist credit falls back to "Unknown artist" — so the
    // gateway always gets a real filename.
    expect(dlBaseName({ name: '***', artists: { primary: [{ name: '' }] } })).toBe('Unknown artist - song')
    expect(dlBaseName({})).toBe('Unknown artist - song')
  })

  it('points at the gateway /dl endpoint with an id, quality, url and name', () => {
    const url = new URL(dlUrlFor(song, '320kbps'), 'http://localhost')
    expect(url.pathname).toBe('/dl')
    expect(url.searchParams.get('songId')).toBe('abc123')
    expect(url.searchParams.get('q')).toBe('320kbps')
    expect(url.searchParams.get('url')).toBe('https://cdn/320')
    expect(url.searchParams.get('name')).toBe('Arijit Singh, Mithoon - Guzarish & Co')
  })
})
