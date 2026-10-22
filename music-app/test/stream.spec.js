import { describe, expect, it } from 'vitest'
import {
  EXPIRY_GRACE_SEC,
  FAILURE,
  classifyMediaError,
  failureMessage,
  isExpired,
  isRetryable,
  nextQuality,
  parseExpiry,
  recoveryPlan,
} from '../src/lib/stream.js'

describe('classifyMediaError', () => {
  it.each([
    [1, FAILURE.aborted],
    [2, FAILURE.network],
    [3, FAILURE.decode],
    [4, FAILURE.unsupported],
  ])('maps MediaError %i', (code, reason) => {
    expect(classifyMediaError({ code })).toBe(reason)
  })

  it('reads an error off the event target and tolerates garbage', () => {
    expect(classifyMediaError({ target: { error: { code: 2 } } })).toBe(FAILURE.network)
    expect(classifyMediaError(null)).toBe(FAILURE.unknown)
  })

  it('only treats transport failures as retryable', () => {
    expect(isRetryable(FAILURE.network)).toBe(true)
    expect(isRetryable(FAILURE.decode)).toBe(false)
    expect(failureMessage(FAILURE.decode)).toMatch(/could not be decoded/i)
  })
})

describe('signed URL expiry', () => {
  const url = (q) => `https://cdn.example.com/a.mp4?${q}`

  it('parses an expiry in seconds', () => {
    expect(parseExpiry(url('expire=1700000000'))).toBe(1700000000)
  })

  it('parses an expiry in milliseconds', () => {
    expect(parseExpiry(url('expire=1700000000000'))).toBe(1700000000)
  })

  it('returns null for unsigned URLs and junk', () => {
    expect(parseExpiry(url('a=1'))).toBeNull()
    expect(parseExpiry('not a url at all')).toBeNull()
    expect(parseExpiry(undefined)).toBeNull()
    expect(parseExpiry(url('expire=soon'))).toBeNull()
  })

  it('flags a URL as stale just before it expires, with grace', () => {
    const at = 1700000000
    expect(isExpired(url(`expire=${at}`), (at + 5) * 1000)).toBe(true)
    expect(isExpired(url(`expire=${at}`), (at - EXPIRY_GRACE_SEC - 10) * 1000)).toBe(false)
    expect(isExpired(url('a=1'), Date.now())).toBe(false)
  })
})

describe('nextQuality', () => {
  const tiers = ['320kbps', '160kbps', '96kbps', '48kbps', '12kbps']

  it('steps down one tier at a time', () => {
    expect(nextQuality(tiers, '320kbps')).toBe('160kbps')
    expect(nextQuality(tiers, '96kbps')).toBe('48kbps')
  })

  it('returns null at the bottom rather than looping', () => {
    expect(nextQuality(tiers, '12kbps')).toBeNull()
  })

  it('accepts API objects as well as plain strings', () => {
    expect(nextQuality([{ quality: '320kbps' }, { quality: '96kbps' }], '320kbps')).toBe('96kbps')
  })
})

describe('recoveryPlan', () => {
  const tiers = ['320kbps', '160kbps', '96kbps']

  it('refreshes a stale URL first, then downgrades, then gives up', () => {
    const plan = recoveryPlan({ reason: FAILURE.staleUrl, quality: '320kbps', available: tiers })
    expect(plan.map((s) => s.action)).toEqual(['refresh_url', 'downgrade', 'give_up'])
    expect(plan[1].quality).toBe('160kbps')
  })

  it('retries a network drop once before degrading the audio', () => {
    const plan = recoveryPlan({ reason: FAILURE.network, attempt: 0, quality: '320kbps', available: tiers })
    expect(plan.map((s) => s.action)).toEqual(['retry', 'downgrade', 'give_up'])
  })

  it('does not retry a decode failure — that needs a different codec', () => {
    const plan = recoveryPlan({ reason: FAILURE.decode, attempt: 0, quality: '320kbps', available: tiers })
    expect(plan.map((s) => s.action)).toEqual(['downgrade', 'give_up'])
  })

  it('gives up immediately when there is nothing left to try', () => {
    const plan = recoveryPlan({ reason: FAILURE.unsupported, quality: '12kbps', available: ['12kbps'] })
    expect(plan).toEqual([{ action: 'give_up' }])
  })
})
