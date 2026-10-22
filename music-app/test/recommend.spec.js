import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REC,
  NEXT,
  REC_REASON,
  STOP_REASON,
  decideNext,
  insertBudget,
  noteDismissed,
  pickCandidate,
  playedOutcome,
  pruneDismissed,
  shouldExplore,
} from '../src/lib/recommend.js'

const c = (song) => ({
  id: song,
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn/x.mp4' }],
  artists: { primary: [{ name: song }] },
})

describe('insertBudget', () => {
  it('is zero for a short context — short queues should not be interrupted', () => {
    expect(insertBudget(0)).toBe(0)
    expect(insertBudget(15)).toBe(0)
  })

  it('allows one insertion per three tracks once the context is long enough', () => {
    expect(insertBudget(18)).toBe(6)
    expect(insertBudget(30)).toBe(10)
  })

  it('respects a configured cadence', () => {
    expect(insertBudget(24, { insertEvery: 4 })).toBe(6)
  })
})

describe('decideNext — the ladder', () => {
  it('continues in context when there is a next user track', () => {
    expect(decideNext({ queueLength: 10, index: 2 })).toEqual({ kind: NEXT.inContext, index: 3 })
  })

  it('loops a single track when repeat is one', () => {
    expect(decideNext({ queueLength: 10, index: 4, repeat: 'one' })).toMatchObject({
      kind: NEXT.inContext,
      loop: true,
    })
  })

  it('wraps when repeat is all and the context ends', () => {
    expect(decideNext({ queueLength: 10, index: 9, repeat: 'all' })).toEqual({
      kind: NEXT.inContext,
      index: 0,
      wrapped: true,
    })
  })

  it('does not insert into a context shorter than the minimum', () => {
    const plan = decideNext({
      queueLength: 8,
      index: 2,
      shuffle: 'smart',
      smartShuffle: true,
      candidate: c('x'),
    })
    expect(plan.kind).toBe(NEXT.inContext)
  })

  it('inserts one recommendation per budget into a long playlist', () => {
    const plan = decideNext({
      queueLength: 20,
      index: 2,
      shuffle: 'smart',
      smartShuffle: true,
      candidate: c('x'),
      reason: REC_REASON.sameArtist,
      insertsUsed: 0,
    })
    expect(plan).toMatchObject({ kind: NEXT.smartInsert, reason: REC_REASON.sameArtist })
  })

  it('stops inserting once the budget is spent, and keeps playing user tracks', () => {
    const plan = decideNext({
      queueLength: 20,
      index: 6,
      shuffle: 'smart',
      smartShuffle: true,
      candidate: c('x'),
      insertsUsed: Math.floor(20 / DEFAULT_REC.insertEvery),
    })
    expect(plan.kind).toBe(NEXT.inContext)
    expect(plan.index).toBe(7)
  })

  it('randomises the pick in plain shuffle mode rather than walking the list', () => {
    expect(decideNext({ queueLength: 10, index: 3, shuffle: 'on' })).toEqual({
      kind: NEXT.inContext,
      shuffle: true,
    })
  })

  it('hands over to an autoplay tail when the context runs out', () => {
    const plan = decideNext({
      queueLength: 5,
      index: 4,
      repeat: 'off',
      autoplay: true,
      candidate: c('next'),
    })
    expect(plan).toMatchObject({ kind: NEXT.autoplay, reason: REC_REASON.sameArtist })
  })

  it('distinguishes "recommender failed" from "queue empty"', () => {
    expect(
      decideNext({ queueLength: 5, index: 4, repeat: 'off', autoplay: true, candidate: null })
    ).toEqual({ kind: NEXT.stop, stopReason: STOP_REASON.autoplayFailed })

    expect(decideNext({ queueLength: 0, index: -1 })).toEqual({
      kind: NEXT.stop,
      stopReason: STOP_REASON.contextExhausted,
    })
  })

  it('falls to radio when autoplay has already failed but radio is on', () => {
    const plan = decideNext({
      queueLength: 5,
      index: 4,
      repeat: 'off',
      autoplay: true,
      autoplayFailed: true,
      radio: true,
      candidate: c('seed'),
    })
    expect(plan.kind).toBe(NEXT.radio)
  })

  it('stops with a typed reason when nothing can continue', () => {
    const plan = decideNext({ queueLength: 3, index: 2, repeat: 'off' })
    expect(plan).toEqual({ kind: NEXT.stop, stopReason: STOP_REASON.contextExhausted })
  })
})

describe('pickCandidate', () => {
  const seed = {
    id: 'seed',
    duration: 200,
    artists: { primary: [{ name: 'Anirudh' }] },
    album: { id: 'a1' },
  }

  it('never returns a dismissed, already-queued or unplayable song', () => {
    const pool = [
      { ...c('dismissed'), duration: 200 },
      { ...c('queued'), duration: 200 },
      { ...c('no-url'), downloadUrl: [], duration: 200 },
    ]
    expect(
      pickCandidate(pool, {
        seed,
        dismissed: new Set(['dismissed']),
        inQueue: new Set(['queued']),
        rand: () => 0.5,
      })
    ).toBeNull()
  })

  it('prefers the same artist and a similar duration', () => {
    const sameArtist = { ...c('anirudh'), duration: 205 }
    const other = { ...c('stranger'), duration: 420 }
    const picked = pickCandidate([other, sameArtist], { seed, rand: () => 0.5 })
    expect(picked.id).toBe('anirudh')
  })

  it('matches through a featuring credit in the subtitle', () => {
    const feat = {
      id: 'feat',
      duration: 200,
      subtitle: 'Anirudh, Someone Else',
      downloadUrl: [{ quality: '320kbps', url: 'x' }],
    }
    const other = { ...c('nobody'), duration: 200 }
    expect(pickCandidate([other, feat], { seed, rand: () => 0.5 }).id).toBe('feat')
  })
})

describe('feedback retention', () => {
  const day = 24 * 60 * 60 * 1000
  const now = 1_700_000_000_000

  it('drops dismissals older than the retention window', () => {
    const map = { fresh: now - 5 * day, stale: now - 40 * day }
    expect(Object.keys(pruneDismissed(map, now))).toEqual(['fresh'])
  })

  it('records a dismissal without mutating the input map', () => {
    const before = { a: 1 }
    const after = noteDismissed(before, 'b', now)
    expect(before).toEqual({ a: 1 })
    expect(after.b).toBe(now)
  })

  it('treats a skip before 30 s of a recommendation as a strong negative', () => {
    expect(playedOutcome({ playedSec: 12, wasRecommendation: true }).strongNegative).toBe(true)
    expect(playedOutcome({ playedSec: 40, wasRecommendation: true }).strongNegative).toBe(false)
    expect(playedOutcome({ playedSec: 40 }).success).toBe(true)
  })

  it('explores only within the configured epsilon', () => {
    expect(shouldExplore(0.06, () => 0.01)).toBe(true)
    expect(shouldExplore(0.06, () => 0.9)).toBe(false)
    expect(shouldExplore(0, () => 0)).toBe(false)
  })
})
