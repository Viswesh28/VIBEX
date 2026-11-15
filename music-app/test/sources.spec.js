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

  it('describes YouTube Music songs and videos as pure audio tracks with no video window', () => {
    const yt = sourceOf(SOURCE_ID.ytmusic)
    expect(yt.plays).toBe('here')
    expect(yt.note).toMatch(/pure audio tracks/i)
    expect(yt.note).not.toMatch(/video and ads/i)
    expect(yt.note).not.toMatch(/YouTube’s own player/i)
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

  it('sends a YouTube track to YouTube’s player and names that as the reason', () => {
    const t = mapYtResult(ytResult)
    // No player to hand it to: a refusal that says so.
    expect(playbackPlan(t)).toEqual({ playable: false, reason: PLAYBACK_REASON.embed })
    // A player: the item goes there, with the id the iframe needs.
    expect(playbackPlan(t, { embed: true })).toMatchObject({
      playable: false,
      mode: 'embed',
      videoId: ytResult.videoId,
      reason: PLAYBACK_REASON.embed,
    })
    expect(playbackPlan(t, { embed: true }).willMint).toBeUndefined()
  })

  it('never mints, whatever the platform or capability arguments claim', () => {
    const t = mapYtResult(ytResult)
    for (const opts of [{ native: true }, { canMint: true }, { native: true, canMint: true }]) {
      const plan = playbackPlan(t, opts)
      expect(plan.willMint, JSON.stringify(opts)).toBeUndefined()
      expect(plan.reason, JSON.stringify(opts)).toBe(PLAYBACK_REASON.embed)
    }
  })

  it('refuses a YouTube item with no usable video id, instead of an empty embed', () => {
    expect(playbackPlan({ id: 'yt:', source: 'ytmusic' }, { embed: true })).toEqual({
      playable: false,
      reason: PLAYBACK_REASON.noVideo,
    })
  })

  it('sends a long YouTube video to the embed instead of a mint', () => {
    // A one-hour mix is not a track: no mint, no gate, no 200 MB pull.
    const mix = mapYtResult({ ...ytResult, videoId: 'mix12345678', duration: 3600 })
    const plan = playbackPlan(mix, { embed: true })
    expect(plan).toMatchObject({
      playable: false,
      mode: 'embed',
      videoId: 'mix12345678',
      reason: PLAYBACK_REASON.longForm,
    })
    // And it is not something the player would try to mint behind our back.
    expect(plan.willMint).toBeUndefined()
  })

  it('embeds a normal-length YouTube track too — the twenty-minute rule is moot', () => {
    const t = mapYtResult(ytResult) // 200 s
    expect(playbackPlan(t, { embed: true })).toMatchObject({
      mode: 'embed',
      videoId: ytResult.videoId,
      reason: PLAYBACK_REASON.embed,
    })
  })

  it('embeds on the device as well, where no mint exists any more', () => {
    const mix = mapYtResult({ ...ytResult, videoId: 'mix12345678', duration: 3600 })
    const plan = playbackPlan(mix, { native: true, embed: true })
    expect(plan).toMatchObject({
      mode: 'embed',
      videoId: 'mix12345678',
      reason: PLAYBACK_REASON.longForm,
    })
    expect(plan.willMint).toBeUndefined()
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
      expect(copy).toMatch(/choose JioSaavn|no stream|audio track/i)
      expect(copy).not.toMatch(/video and ads/i)
    }
  })
})
