import { describe, expect, it } from 'vitest'
import {
  CROSSFADE_LAWS,
  TRANSITION,
  REFUSAL,
  DEFAULT_PLAN_CFG,
  bassSwapDb,
  camelotDistance,
  canAutoMix,
  clamp01,
  describePlan,
  fadeGains,
  normaliseLaw,
  pickPhraseBoundary,
  planTransition,
  rampCurve,
} from '../src/lib/transition.js'

describe('crossfade curves', () => {
  it('equal power holds out² + in² = 1 across the whole ramp', () => {
    for (let i = 0; i <= 200; i++) {
      const { out, in: incoming } = fadeGains('equalPower', i / 200)
      expect(out * out + incoming * incoming).toBeCloseTo(1, 6)
    }
  })

  it('linear holds out + in = 1 and is the correlated-material law', () => {
    for (let i = 0; i <= 100; i++) {
      const { out, in: incoming } = fadeGains('linear', i / 100)
      expect(out + incoming).toBeCloseTo(1, 6)
    }
  })

  it.each(CROSSFADE_LAWS)('%s starts fully on the outgoing track and ends on the incoming one', (law) => {
    expect(fadeGains(law, 0)).toEqual({ out: 1, in: 0 })
    const end = fadeGains(law, 1)
    expect(end.out).toBeCloseTo(0, 6)
    expect(end.in).toBeCloseTo(1, 6)
  })

  it('clamps ramp positions instead of producing NaN', () => {
    expect(clamp01(-3)).toBe(0)
    expect(clamp01(9)).toBe(1)
    expect(clamp01('nope')).toBe(0)
    expect(fadeGains('equalPower', Number.NaN)).toEqual({ out: 1, in: 0 })
  })

  it('falls back to equal power for an unknown law', () => {
    expect(normaliseLaw('bogus')).toBe('equalPower')
    expect(fadeGains('bogus', 0.5)).toEqual(fadeGains('equalPower', 0.5))
  })

  it('bass swap never doubles the low band: both legs are cut at the crossing', () => {
    const mid = bassSwapDb(0.5)
    expect(mid.out).toBeLessThan(-10)
    expect(mid.in).toBeLessThan(-10)
    expect(bassSwapDb(0).out).toBeCloseTo(0, 6)
    expect(bassSwapDb(1).in).toBeCloseTo(0, 6)
    expect(bassSwapDb(0).in).toBeLessThanOrEqual(-40)
  })

  it('builds a fixed-length curve for setValueCurveAtTime with the right endpoints', () => {
    const out = rampCurve('equalPower', 'out', 64)
    const incoming = rampCurve('equalPower', 'in', 64)
    expect(out).toHaveLength(64)
    expect(incoming).toHaveLength(64)
    expect(out[0]).toBeCloseTo(1, 6)
    expect(out[63]).toBeCloseTo(0, 6)
    expect(incoming[0]).toBeCloseTo(0, 6)
    expect(incoming[63]).toBeCloseTo(1, 6)
    // Golden property from the spec: power is constant across the ramp.
    out.forEach((g, i) => {
      expect(g * g + incoming[i] * incoming[i]).toBeCloseTo(1, 5)
    })
  })
})

describe('camelotDistance', () => {
  it('treats the same key as distance 0', () => {
    expect(camelotDistance('8A', '8A')).toBe(0)
  })
  it('walks the wheel in both directions', () => {
    expect(camelotDistance('8A', '9A')).toBe(1)
    expect(camelotDistance('1A', '12A')).toBe(1)
    expect(camelotDistance('8A', '2A')).toBe(6)
  })
  it('treats relative major/minor as adjacent', () => {
    expect(camelotDistance('8A', '8B')).toBe(1)
  })
  it('is Infinity when a key cannot be read', () => {
    expect(camelotDistance('', '8A')).toBe(Infinity)
    expect(camelotDistance('13A', '8A')).toBe(Infinity)
  })
})

describe('planTransition — cheapest acceptable option first', () => {
  const analysisA = { bpm: 124, bpmConfidence: 0.9, key: { camelot: '8A' }, end: 200, barLength: 4 }
  const analysisB = { bpm: 126, bpmConfidence: 0.88, key: { camelot: '9A' }, leadSilence: 0 }

  it('cuts on a manual skip, regardless of settings', () => {
    const plan = planTransition({ a: analysisA, b: analysisB, manualSkip: true, crossfadeOn: true })
    expect(plan.type).toBe(TRANSITION.hardCut)
    expect(plan.lengthSec).toBe(0)
    expect(plan.refusals).toContain(REFUSAL.manualSkip)
  })

  it('cuts when crossfade is off', () => {
    const plan = planTransition({ crossfadeOn: false })
    expect(plan.type).toBe(TRANSITION.hardCut)
    expect(plan.reason).toBe(REFUSAL.crossfadeOff)
  })

  it('treats 0 s as gapless, which is not a zero-length crossfade', () => {
    const plan = planTransition({ crossfadeOn: true, crossfadeSec: 0 })
    expect(plan.type).toBe(TRANSITION.hardCut)
    expect(plan.reason).toBe(REFUSAL.gaplessOnly)
  })

  it('trims dead air instead of blending it', () => {
    const plan = planTransition({
      a: { ...analysisA, tailSilence: 14 },
      b: analysisB,
      crossfadeSec: 5,
    })
    expect(plan.type).toBe(TRANSITION.trimSilence)
    expect(plan.lengthSec).toBe(0)
    expect(plan.atSec).toBe(186)
  })

  it('beat-matches when tempo and key agree, and returns the stretch rate', () => {
    const plan = planTransition({ a: analysisA, b: analysisB, crossfadeSec: 5 })
    expect(plan.type).toBe(TRANSITION.beatMatched)
    expect(plan.rate).toBeCloseTo(126 / 124, 5)
    expect(plan.lengthBars).toBe(8)
  })

  it('refuses to mix an album played in sequence, and says why', () => {
    const plan = planTransition({ a: analysisA, b: analysisB, sequentialAlbum: true })
    expect(plan.type).toBe(TRANSITION.crossfade)
    expect(plan.refusals).toContain(REFUSAL.sequentialAlbum)
  })

  it('refuses without analysis and falls back to a plain crossfade', () => {
    const plan = planTransition({ a: { end: 200 }, b: { leadSilence: 0 }, crossfadeSec: 4 })
    expect(plan.type).toBe(TRANSITION.crossfade)
    expect(plan.refusals).toContain(REFUSAL.noAnalysis)
    expect(plan.lengthSec).toBe(4)
  })

  it('uses a filtered crossfade when tempos are too far apart', () => {
    const plan = planTransition({
      a: analysisA,
      b: { ...analysisB, bpm: 160, key: { camelot: '9A' } },
    })
    expect(plan.type).toBe(TRANSITION.filteredCrossfade)
    expect(plan.refusals).toContain(REFUSAL.tempoMismatch)
    expect(plan.filter.kind).toBe('lowpass')
  })

  it('marks a key clash while still beat-matching the tempo', () => {
    const plan = planTransition({ a: analysisA, b: { ...analysisB, key: { camelot: '2A' } } })
    expect(plan.type).toBe(TRANSITION.filteredCrossfade)
    expect(plan.refusals).toContain(REFUSAL.keyClash)
  })

  it('carries the chosen law through', () => {
    const plan = planTransition({ a: { end: 100 }, b: {}, law: 'linear', crossfadeSec: 6 })
    expect(plan.law).toBe('linear')
    expect(plan.atSec).toBe(94)
  })

  it('clamps an out-of-range duration', () => {
    expect(planTransition({ crossfadeSec: 90 }).lengthSec).toBe(12)
    expect(planTransition({ crossfadeSec: -5 }).lengthSec).toBe(0)
  })
})

describe('pickPhraseBoundary', () => {
  it('prefers the latest phrase start outside the drop guard', () => {
    const at = pickPhraseBoundary({
      end: 200,
      bpm: 120,
      barLength: 4,
      phraseStarts: [120, 152, 184, 197],
      dropGuardSec: DEFAULT_PLAN_CFG.dropGuardSec,
    })
    // 197 is inside the guarded window (200 - 4), so 184 wins.
    expect(at).toBe(184)
  })

  it('falls back to a phrase-length offset when no grid is known', () => {
    const at = pickPhraseBoundary({ end: 200, bpm: 120, barLength: 4, phraseStarts: [] })
    expect(at).toBeGreaterThan(150)
    expect(at).toBeLessThan(200)
  })
})

describe('canAutoMix', () => {
  it('requires confident analysis', () => {
    expect(canAutoMix({ analysis: { bpm: 120, bpmConfidence: 0.2 } })).toEqual({
      ok: false,
      reason: REFUSAL.lowConfidence,
    })
    expect(canAutoMix({ analysis: { bpm: 120, bpmConfidence: 0.9 } }).ok).toBe(true)
  })

  it('honours the refusal list', () => {
    expect(canAutoMix({ analysis: { bpm: 120, bpmConfidence: 1 }, lossless: true }).reason).toBe(
      REFUSAL.lossless
    )
  })
})

describe('describePlan', () => {
  it('explains a downgrade in one line', () => {
    expect(describePlan(planTransition({ crossfadeOn: false }))).toMatch(/crossfade is off/i)
    expect(
      describePlan(planTransition({ a: { end: 100 }, b: {}, crossfadeSec: 5 }))
    ).toMatch(/crossfade — 5s/i)
  })
})
