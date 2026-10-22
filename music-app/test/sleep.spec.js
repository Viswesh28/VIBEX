import { describe, expect, it } from 'vitest'
import {
  SLEEP_FADE_SEC,
  describeSleep,
  sleepExpired,
  sleepGain,
} from '../src/lib/sleep.js'

describe('sleepGain', () => {
  it('is full volume for a timer that is not running', () => {
    expect(sleepGain(0, 0)).toBe(1)
    expect(sleepGain(500, 0)).toBe(1)
    expect(sleepGain(0, Number.NaN)).toBe(1)
  })

  it('holds at full volume until the fade window opens', () => {
    expect(sleepGain(0, 900)).toBe(1)
    expect(sleepGain(880 - SLEEP_FADE_SEC, 900)).toBe(1)
  })

  it('rides an equal-power cosine down to silence at the end', () => {
    const total = 900
    const mid = total - SLEEP_FADE_SEC / 2
    expect(sleepGain(mid, total)).toBeCloseTo(Math.cos(Math.PI / 4), 5)
    expect(sleepGain(total, total)).toBeCloseTo(0, 6)
    expect(sleepGain(total + 5, total)).toBe(0)
  })

  it('never rises once it has started falling', () => {
    let prev = 1
    for (let t = 860; t <= 900; t += 1) {
      const g = sleepGain(t, 900)
      expect(g).toBeLessThanOrEqual(prev + 1e-9)
      prev = g
    }
  })

  it('handles a timer shorter than the fade window', () => {
    // A 10 s timer cannot fade for 20 s; it must still reach 0 exactly at the end.
    expect(sleepGain(0, 10)).toBe(1)
    expect(sleepGain(10, 10)).toBeCloseTo(0, 6)
    expect(sleepGain(5, 10)).toBeLessThan(1)
  })

  it('ignores negative or junk elapsed values', () => {
    expect(sleepGain(-30, 900)).toBe(1)
    expect(sleepGain('nope', 900)).toBe(1)
  })
})

describe('sleepExpired', () => {
  it('only fires once the timer has actually run out', () => {
    expect(sleepExpired(899, 900)).toBe(false)
    expect(sleepExpired(900, 900)).toBe(true)
    expect(sleepExpired(901, 900)).toBe(true)
  })

  it('never fires without a timer', () => {
    expect(sleepExpired(9999, 0)).toBe(false)
  })
})

describe('describeSleep', () => {
  it('says playback continues when nothing is set', () => {
    expect(describeSleep(0, 0)).toMatch(/continues/i)
  })

  it('calls out the fade window explicitly', () => {
    expect(describeSleep(15_000, 900)).toMatch(/fading out/i)
  })

  it('counts down in minutes outside the fade window', () => {
    expect(describeSleep(120_000, 900)).toMatch(/stops in 2m/i)
  })

  it('reports stopping at zero', () => {
    expect(describeSleep(0, 900)).toMatch(/stopping now/i)
  })
})
