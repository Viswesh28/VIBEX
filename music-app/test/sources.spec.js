// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  PLAYBACK_REASON,
  SOURCES,
  SOURCE_ID,
  cataloguePath,
  isYtTrack,
  mapYtResult,
  mapYtResults,
  normalizeSource,
  playbackCopy,
  playbackPlan,
  sourceOf,
} from '../src/lib/sources.js'

const saavnSong = {
  id: 'YiVML4Zo',
  name: 'Gehra Hua',
  downloadUrl: [{ quality: '320kbps', url: 'https://aac.saavncdn.com/x_320.mp4' }],
}

const ytResult = {
  videoId: 'J7p4bzqLvCw',
  title: 'Blinding Lights',
  artists: ['The Weeknd'],
  album: 'After Hours',
  duration: 200,
  thumbnail: 'https://lh3.googleusercontent.com/thumb',
}

describe('the source registry', () => {
  it('offers exactly the two catalogues a listener can pick', () => {
    expect(SOURCES.map((s) => s.id)).toEqual([SOURCE_ID.jiosaavn, SOURCE_ID.ytmusic])
  })

  it('never describes YouTube Music as if it could play here', () => {
    const yt = sourceOf(SOURCE_ID.ytmusic)
    expect(yt.plays).toBe('catalogue-only')
    expect(yt.note).toMatch(/cannot play|will not serve audio/i)
  })

  it('falls back to JioSaavn for anything unrecognised', () => {
    // A stale stored value or a typo must not leave the app with no source.
    expect(normalizeSource('spotify')).toBe(SOURCE_ID.jiosaavn)
    expect(normalizeSource(undefined)).toBe(SOURCE_ID.jiosaavn)
    expect(normalizeSource('ytmusic')).toBe(SOURCE_ID.ytmusic)
  })

  it('points each source at its own catalogue endpoint', () => {
    expect(cataloguePath(SOURCE_ID.jiosaavn, 'arijit')).toBe('/search/songs?query=arijit&limit=20')
    expect(cataloguePath(SOURCE_ID.ytmusic, 'blinding lights', 5)).toBe(
      '/ytmusic?query=blinding%20lights&limit=5'
    )
  })
})

describe('mapYtResult', () => {
  it('dresses a YouTube result in the shape the app already reads', () => {
    const t = mapYtResult(ytResult)
    expect(t).toMatchObject({
      id: 'yt:J7p4bzqLvCw',
      videoId: 'J7p4bzqLvCw',
      source: SOURCE_ID.ytmusic,
      name: 'Blinding Lights',
      duration: 200,
    })
    expect(t.artists.primary[0].name).toBe('The Weeknd')
    expect(t.image[0].url).toBe('https://lh3.googleusercontent.com/thumb')
    expect(t.url).toContain('music.youtube.com/watch?v=J7p4bzqLvCw')
  })

  it('carries no stream, because there is none to carry', () => {
    // An empty list is what the player already treats as unplayable; inventing
    // a URL here would be the false promise this project keeps refusing.
    expect(mapYtResult(ytResult).downloadUrl).toEqual([])
  })

  it('survives a result with no artist or artwork', () => {
    const t = mapYtResult({ videoId: 'abcdefghijk', title: 'Untitled' })
    expect(t.artists.primary).toEqual([])
    expect(t.image).toEqual([])
    expect(t.duration).toBe(0)
  })

  it('drops rows without an id or a title', () => {
    expect(mapYtResult({ title: 'no id' })).toBeNull()
    expect(mapYtResult({ videoId: 'J7p4bzqLvCw' })).toBeNull()
    expect(mapYtResults([ytResult, null, { title: 'x' }])).toHaveLength(1)
    expect(mapYtResults('nope')).toEqual([])
  })
})

describe('isYtTrack', () => {
  it('recognises a YouTube track by tag, prefix or video id', () => {
    expect(isYtTrack(mapYtResult(ytResult))).toBe(true)
    expect(isYtTrack({ id: 'yt:abc' })).toBe(true)
    expect(isYtTrack({ videoId: 'abc' })).toBe(true)
    expect(isYtTrack(saavnSong)).toBe(false)
    expect(isYtTrack(null)).toBe(false)
  })
})

describe('playbackPlan', () => {
  it('lets a JioSaavn track with a stream play', () => {
    expect(playbackPlan(saavnSong)).toEqual({ playable: true, reason: PLAYBACK_REASON.ok })
  })

  it('refuses a YouTube track and says why, per platform', () => {
    const t = mapYtResult(ytResult)
    // In a browser there is nothing that can mint, so the refusal is final.
    expect(playbackPlan(t).reason).toBe(PLAYBACK_REASON.needsApp)
    expect(playbackPlan(t).willMint).toBeUndefined()
    // On the device the app will *attempt* a mint, so the reason is a failure
    // summary rather than a claim about the server.
    expect(playbackPlan(t, { native: true })).toMatchObject({
      playable: false,
      willMint: true,
      reason: PLAYBACK_REASON.mintFailed,
    })
  })

  it('will attempt a mint in a browser that has the extension', () => {
    const t = mapYtResult(ytResult)
    // A plain tab: final refusal.
    expect(playbackPlan(t, { canMint: false }).willMint).toBeUndefined()
    // Extension installed: attempt, with the mint's own failure summary.
    expect(playbackPlan(t, { canMint: true })).toMatchObject({
      willMint: true,
      reason: PLAYBACK_REASON.mintFailed,
    })
  })

  it('refuses anything else with no stream, without pretending it is YouTube', () => {
    expect(playbackPlan({ id: 'x', downloadUrl: [] }).reason).toBe(PLAYBACK_REASON.noStream)
    expect(playbackPlan(null).playable).toBe(false)
  })

  it('has a sentence for every reason, and none of them is a dead end', () => {
    for (const reason of Object.values(PLAYBACK_REASON)) {
      if (reason === PLAYBACK_REASON.ok) continue
      const copy = playbackCopy(reason)
      expect(copy, reason).toBeTruthy()
      // Each refusal points at a way forward rather than just stopping.
      expect(copy).toMatch(/choose JioSaavn|no stream/i)
    }
  })
})
