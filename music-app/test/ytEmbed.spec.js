// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  EMBED_NOTE,
  LONG_FORM_SEC,
  embedUrl,
  isLongForm,
  videoIdOf,
} from '../src/lib/ytEmbed.js'

/**
 * The embed policy, tested without a browser.
 *
 * Everything here is a pure function, which is the point: the one place this
 * feature can be wrong in an unrecoverable way is the decision of *what* goes
 * to YouTube's player, and that decision should never need a live iframe to
 * check.
 */

const long = { id: 'yt:dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ', duration: LONG_FORM_SEC + 5 }
const track = { id: 'yt:dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ', duration: 200 }

describe('videoIdOf', () => {
  it('reads the id from either shape a track arrives in', () => {
    expect(videoIdOf({ videoId: 'dQw4w9WgXcQ' })).toBe('dQw4w9WgXcQ')
    expect(videoIdOf({ id: 'yt:dQw4w9WgXcQ' })).toBe('dQw4w9WgXcQ')
    expect(videoIdOf({ id: 'yt:dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ' })).toBe('dQw4w9WgXcQ')
  })

  it('returns nothing rather than a guess for anything malformed', () => {
    expect(videoIdOf(null)).toBe('')
    expect(videoIdOf({})).toBe('')
    expect(videoIdOf({ videoId: 'too-short' })).toBe('')
    expect(videoIdOf({ id: 'saavnSongId' })).toBe('')
  })
})

describe('isLongForm', () => {
  it('draws the line at twenty minutes, inclusive', () => {
    expect(isLongForm({ ...track, duration: LONG_FORM_SEC - 1 })).toBe(false)
    expect(isLongForm({ ...track, duration: LONG_FORM_SEC })).toBe(true)
    expect(isLongForm(long)).toBe(true)
  })

  it('never claims a track with no length, and never a non-YouTube id', () => {
    expect(isLongForm({ videoId: 'dQw4w9WgXcQ' })).toBe(false)
    expect(isLongForm({ videoId: 'dQw4w9WgXcQ', duration: 0 })).toBe(false)
    expect(isLongForm({ id: 'abc', duration: 9999 })).toBe(false)
  })
})

describe('embedUrl', () => {
  it('points at the embed host and keeps the id intact', () => {
    const url = new URL(embedUrl(track))
    expect(url.origin).toBe('https://www.youtube.com')
    expect(url.pathname).toBe('/embed/dQw4w9WgXcQ')
    expect(url.searchParams.get('autoplay')).toBe('1')
    expect(url.searchParams.get('rel')).toBe('0')
  })

  it('passes the origin through when the caller has one', () => {
    const url = new URL(embedUrl(track, { origin: 'https://vibex-music-pi.vercel.app' }))
    expect(url.searchParams.get('origin')).toBe('https://vibex-music-pi.vercel.app')
  })

  it('omits autoplay when asked, and refuses a track with no id', () => {
    expect(new URL(embedUrl(track, { autoplay: false })).searchParams.get('autoplay')).toBe('0')
    expect(embedUrl({ id: 'nope' })).toBeNull()
    expect(embedUrl(null)).toBeNull()
  })
})

describe('the copy', () => {
  it('says where the sound is coming from', () => {
    expect(EMBED_NOTE).toMatch(/YouTube/i)
  })
})
