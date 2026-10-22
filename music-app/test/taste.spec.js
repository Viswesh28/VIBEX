import { describe, expect, it } from 'vitest'
import {
  TASTE,
  artistKey,
  artistKeysOf,
  buildTaste,
  describeTaste,
  pickSeeds,
  rankByTaste,
  recentlyPlayedIds,
  recencyWeight,
  songAffinity,
  songWeight,
} from '../src/lib/taste.js'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

/** A stats store shaped the way LibraryContext writes it. */
const stats = (songs) => ({ plays: 0, seconds: 0, songs, artists: {} })

const entry = (n, sec, dur, last, artist = 'Anirudh') => ({ n, sec, dur, last, artist, name: 'x' })

describe('artistKey', () => {
  it('collides the spellings of one artist', () => {
    expect(artistKey('A. R. Rahman')).toBe(artistKey('A R Rahman'))
    expect(artistKey('Anirudh')).toBe(artistKey('  ANIRUDH '))
  })

  it('drops featuring credits and bracketed suffixes', () => {
    expect(artistKey('Anirudh (feat. Someone)')).toBe('anirudh')
    expect(artistKey('Anirudh ft. X')).toBe('anirudh')
  })

  it('splits a multi-artist credit', () => {
    expect(artistKeysOf('Anirudh, Sid Sriram')).toEqual(['anirudh', 'sid sriram'])
  })
})

describe('songWeight', () => {
  it('treats a skipped play as worth much less than a full one', () => {
    const full = songWeight(entry(3, 3 * 200, 200, NOW), NOW)
    const skipped = songWeight(entry(3, 3 * 10, 200, NOW), NOW)
    expect(full).toBeGreaterThan(skipped * 3)
  })

  it('prefers more plays of the same song', () => {
    expect(songWeight(entry(5, 5 * 200, 200, NOW), NOW)).toBeGreaterThan(
      songWeight(entry(1, 200, 200, NOW), NOW)
    )
  })

  it('decays with age, by half every half-life', () => {
    const fresh = recencyWeight(NOW, NOW)
    const oneHalfLife = recencyWeight(NOW - TASTE.halfLifeDays * DAY, NOW)
    expect(fresh).toBeCloseTo(1, 5)
    expect(oneHalfLife).toBeCloseTo(0.5, 5)
  })

  it('does not reward a missing timestamp', () => {
    expect(recencyWeight(undefined, NOW)).toBeLessThan(1)
    expect(recencyWeight(0, NOW)).toBe(0.5)
  })

  it('assumes a listen when the duration is unknown', () => {
    expect(songWeight(entry(2, 400, 0, NOW), NOW)).toBeGreaterThan(0)
  })

  it('ignores an entry with no plays', () => {
    expect(songWeight(entry(0, 0, 200, NOW), NOW)).toBe(0)
  })
})

describe('buildTaste', () => {
  it('is a cold start with no history', () => {
    const t = buildTaste(stats({}), { now: NOW })
    expect(t.ready).toBe(false)
    expect(t.artists).toEqual([])
    expect(describeTaste(t)).toBeNull()
  })

  it('is a cold start below the play threshold', () => {
    const t = buildTaste(stats({ a: entry(2, 400, 200, NOW) }), { now: NOW })
    expect(t.plays).toBe(2)
    expect(t.ready).toBe(false)
  })

  it('ranks artists by weighted plays', () => {
    const t = buildTaste(
      stats({
        a: entry(4, 4 * 200, 200, NOW, 'Anirudh'),
        b: entry(2, 2 * 200, 200, NOW, 'Sid Sriram'),
        c: entry(1, 200, 200, NOW, 'Anirudh'),
      }),
      { now: NOW }
    )
    expect(t.ready).toBe(true)
    expect(t.artists[0].label).toBe('Anirudh')
    expect(t.topArtist).toBe('Anirudh')
    expect(t.artists[0].norm).toBeGreaterThan(t.artists[1].norm)
  })

  it('gives a skipped artist less than a fully heard one', () => {
    const t = buildTaste(
      stats({
        a: entry(3, 3 * 8, 200, NOW, 'Skipped Artist'),
        b: entry(3, 3 * 200, 200, NOW, 'Heard Artist'),
      }),
      { now: NOW }
    )
    const skipped = t.artists.find((x) => x.key === 'skipped artist')
    const heard = t.artists.find((x) => x.key === 'heard artist')
    expect(heard.score).toBeGreaterThan(skipped.score)
  })

  it('drops an excluded artist entirely, including duets', () => {
    const t = buildTaste(
      stats({
        a: entry(4, 800, 200, NOW, 'Anirudh'),
        b: entry(4, 800, 200, NOW, 'Blocked'),
        c: entry(2, 400, 200, NOW, 'Blocked, Anirudh'),
      }),
      { excluded: ['Blocked'], now: NOW }
    )
    expect(t.artists.map((a) => a.label)).not.toContain('Blocked')
    // The duet is excluded too, so only the solo plays remain.
    expect(t.songScores.size).toBe(1)
  })

  it('weights a recent obsession above an old one', () => {
    const t = buildTaste(
      stats({
        a: entry(5, 1000, 200, NOW, 'Recent'),
        b: entry(5, 1000, 200, NOW - 90 * DAY, 'Dormant'),
      }),
      { now: NOW }
    )
    expect(t.artists[0].label).toBe('Recent')
    expect(t.artists[1].norm).toBeLessThan(0.2)
  })

  it('survives malformed history', () => {
    expect(buildTaste(null, { now: NOW }).ready).toBe(false)
    expect(buildTaste({ songs: { a: null } }, { now: NOW }).ready).toBe(false)
  })
})

describe('affinity and ranking', () => {
  const taste = buildTaste(
    stats({
      a: entry(6, 1200, 200, NOW, 'Anirudh'),
      b: entry(1, 200, 200, NOW, 'Sid Sriram'),
    }),
    { now: NOW }
  )
  const cand = (id, artist, extra = {}) => ({
    id,
    name: id,
    duration: 200,
    artists: { primary: [{ name: artist }] },
    downloadUrl: [{ quality: '320kbps', url: 'x' }],
    ...extra,
  })

  it('scores a favourite artist above an unknown one', () => {
    expect(songAffinity(cand('a', 'Anirudh'), taste)).toBeGreaterThan(
      songAffinity(cand('b', 'Nobody'), taste)
    )
  })

  it('takes the best credit in a duet', () => {
    expect(songAffinity(cand('c', 'Nobody, Anirudh'), taste)).toBeGreaterThan(0)
  })

  it('orders candidates by affinity', () => {
    const ranked = rankByTaste(
      [cand('unknown', 'Nobody'), cand('fav', 'Anirudh'), cand('meh', 'Sid Sriram')],
      taste,
      { rand: () => 0 }
    )
    expect(ranked.map((s) => s.id)).toEqual(['fav', 'meh', 'unknown'])
  })

  it('removes dismissed, queued, recently played, excluded and unplayable entries', () => {
    const pool = [
      cand('dismissed', 'Anirudh'),
      cand('queued', 'Anirudh'),
      cand('recent', 'Anirudh'),
      cand('blocked', 'Blocked'),
      { ...cand('nostream', 'Anirudh'), downloadUrl: [] },
      cand('ok', 'Anirudh'),
    ]
    const ranked = rankByTaste(pool, taste, {
      dismissed: new Set(['dismissed']),
      inQueue: new Set(['queued']),
      recentlyPlayed: new Set(['recent']),
      excluded: ['Blocked'],
      rand: () => 0,
    })
    expect(ranked.map((s) => s.id)).toEqual(['ok'])
  })

  it('de-duplicates a repeated candidate', () => {
    const ranked = rankByTaste([cand('x', 'Anirudh'), cand('x', 'Anirudh')], taste, { rand: () => 0 })
    expect(ranked).toHaveLength(1)
  })

  it('returns an empty list for an empty pool', () => {
    expect(rankByTaste([], taste)).toEqual([])
    expect(rankByTaste(null, taste)).toEqual([])
  })
})

describe('seeds and recency', () => {
  const taste = buildTaste(
    stats({
      a: entry(5, 1000, 200, NOW, 'Anirudh'),
      b: entry(3, 600, 200, NOW, 'Sid Sriram'),
      c: entry(2, 400, 200, NOW, 'A R Rahman'),
    }),
    { now: NOW }
  )

  it('seeds from the strongest artists, capped', () => {
    expect(pickSeeds(taste, 2)).toEqual(['Anirudh', 'Sid Sriram'])
  })

  it('seeds nothing on a cold profile', () => {
    expect(pickSeeds(buildTaste(stats({}), { now: NOW }))).toEqual([])
  })

  it('knows what was played lately', () => {
    const recent = recentlyPlayedIds(
      stats({ a: { n: 1, sec: 10, dur: 200, last: NOW - DAY }, b: { n: 1, sec: 10, dur: 200, last: NOW - 30 * DAY } }),
      NOW
    )
    expect([...recent]).toEqual(['a'])
  })

  it('explains itself in one line', () => {
    expect(describeTaste(taste)).toBe('Because you keep playing Anirudh')
  })
})
