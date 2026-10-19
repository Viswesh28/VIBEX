import { describe, expect, it, vi, beforeEach } from 'vitest'
import { parseLRC, activeLineIndex, cleanTrackName, fetchLyrics } from '../src/lib/lrc.js'

describe('parseLRC', () => {
  it('parses [mm:ss.xx] timestamps into sorted seconds', () => {
    const lines = parseLRC('[00:12.50] Second\n[00:01.00] First\n[01:02.00] Third')
    expect(lines).toEqual([
      { t: 1, text: 'First' },
      { t: 12.5, text: 'Second' },
      { t: 62, text: 'Third' },
    ])
  })

  it('handles a missing fractional part', () => {
    expect(parseLRC('[00:05] Five')).toEqual([{ t: 5, text: 'Five' }])
  })

  it('scales the fraction by its own digit count, not by 100', () => {
    // .5 is half a second; .50 is also half a second; .500 too.
    expect(parseLRC('[00:00.5] a')[0].t).toBe(0.5)
    expect(parseLRC('[00:00.50] a')[0].t).toBe(0.5)
    expect(parseLRC('[00:00.500] a')[0].t).toBe(0.5)
  })

  it('strips a second timestamp off a repeated chorus line', () => {
    const lines = parseLRC('[00:10.00][00:40.00] Repeated chorus')
    expect(lines).toEqual([{ t: 10, text: 'Repeated chorus' }])
  })

  it('ignores metadata tags and blank text', () => {
    const lrc = '[ar:Artist]\n[ti:Title]\n[00:01.00]\n[00:02.00] Real line'
    expect(parseLRC(lrc)).toEqual([{ t: 2, text: 'Real line' }])
  })

  it('returns [] for empty and non-LRC input', () => {
    expect(parseLRC('')).toEqual([])
    expect(parseLRC(null)).toEqual([])
    expect(parseLRC('just plain lyrics, no timestamps')).toEqual([])
  })
})

describe('activeLineIndex', () => {
  const lines = [
    { t: 0, text: 'a' },
    { t: 5, text: 'b' },
    { t: 10, text: 'c' },
  ]

  it('is -1 before the first line', () => {
    expect(activeLineIndex(lines, -1)).toBe(-1)
  })

  it('selects the latest line that has started', () => {
    expect(activeLineIndex(lines, 0)).toBe(0)
    expect(activeLineIndex(lines, 4.8)).toBe(0) // outside the 150ms lead-in
    expect(activeLineIndex(lines, 5)).toBe(1)
    expect(activeLineIndex(lines, 9.8)).toBe(1)
    expect(activeLineIndex(lines, 10)).toBe(2)
    expect(activeLineIndex(lines, 999)).toBe(2)
  })

  it('lights a line 150ms early so the highlight leads the vocal', () => {
    expect(activeLineIndex(lines, 4.86)).toBe(1)
    expect(activeLineIndex(lines, 4.84)).toBe(0)
  })

  it('is -1 for an empty list', () => {
    expect(activeLineIndex([], 10)).toBe(-1)
  })
})

describe('cleanTrackName', () => {
  it('decodes entities JioSaavn leaves in titles', () => {
    expect(cleanTrackName('Guzarish &amp; Co')).toBe('Guzarish & Co')
  })

  it('drops a parenthetical, a "From ..." suffix and collapses whitespace', () => {
    expect(cleanTrackName('Tum Hi Ho  (From "Aashiqui 2")  - Remaster')).toBe('Tum Hi Ho - Remaster')
  })
})

describe('fetchLyrics', () => {
  const song = { id: 'song1', name: 'Tum Hi Ho', duration: 262, artists: { primary: [{ name: 'Arijit Singh' }] } }

  beforeEach(() => {
    // The module memoises per song id, so every case needs a distinct one.
    song.id = `song-${Math.random().toString(36).slice(2)}`
  })

  const respond = (body, ok = true) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    })

  it('prefers synced lyrics from the closest-duration match', async () => {
    respond([
      { duration: 300, syncedLyrics: '[00:01.00] wrong cut' },
      { duration: 261, syncedLyrics: '[00:01.00] right cut' },
    ])
    const res = await fetchLyrics(song)
    expect(res.type).toBe('synced')
    expect(res.lines).toEqual([{ t: 1, text: 'right cut' }])
  })

  it('falls back to plain text when nothing is synced', async () => {
    respond([{ duration: 262, plainLyrics: 'plain body' }])
    expect(await fetchLyrics(song)).toEqual({ type: 'plain', text: 'plain body' })
  })

  it('reports instrumental rather than empty lyrics', async () => {
    respond([{ duration: 262, instrumental: true }])
    expect(await fetchLyrics(song)).toEqual({ type: 'instrumental' })
  })

  it('reports none for an empty result set', async () => {
    respond([])
    expect(await fetchLyrics(song)).toEqual({ type: 'none' })
  })

  it('reports error, not a throw, when LRCLIB is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await fetchLyrics(song)).toEqual({ type: 'error' })
  })

  it('memoises per song so a repeat open costs no request', async () => {
    const spy = respond([{ duration: 262, plainLyrics: 'x' }])
    await fetchLyrics(song)
    await fetchLyrics(song)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
