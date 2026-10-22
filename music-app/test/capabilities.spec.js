// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CROSS_SOURCE,
  FEATURES,
  NEVER_CLAIM,
  SOURCE,
  STATUS,
  describeVisual,
  feature,
  mediaPlan,
  summary,
} from '../src/lib/capabilities.js'

// Only the rendered surfaces. Engine modules legitimately carry a `lossless`
// flag — transition.js *refuses* to mix on that path — and that is not a claim.
const SRC = fileURLToPath(new URL('../src/components', import.meta.url))

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(jsx?|tsx?)$/.test(name) && !full.endsWith('capabilities.js')) out.push(full)
  }
  return out
}

describe('the capability matrix', () => {
  it('states the real ceiling of the one source', () => {
    expect(SOURCE.id).toBe('jiosaavn')
    expect(SOURCE.maxKbps).toBe(320)
    expect(SOURCE.expiringUrls).toBe(false)
  })

  it('gives every feature a known status and both lines of copy', () => {
    const allowed = new Set(Object.values(STATUS))
    for (const f of FEATURES) {
      expect(f.id, 'id').toBeTruthy()
      expect(f.label, `${f.id} label`).toBeTruthy()
      expect(allowed.has(f.status), `${f.id} status`).toBe(true)
      expect(f.claim, `${f.id} claim`).toBeTruthy()
      expect(f.detail, `${f.id} detail`).toBeTruthy()
    }
  })

  it('never marks an unobtainable feature as available', () => {
    for (const id of NEVER_CLAIM) {
      const f = feature(id)
      expect(f, `${id} must be listed`).not.toBeNull()
      expect(f.status, `${id} must not be sold as available`).toBe(STATUS.unavailable)
    }
  })

  it('marks beat-matched transitions as unfinished rather than shipping a fake', () => {
    expect(feature('beatMatch').status).toBe(STATUS.local)
  })

  it('declares canvas video as cross-source, not as catalogue data', () => {
    // The audio is JioSaavn; the clip is YouTube. The qualifier is not optional.
    expect(CROSS_SOURCE).toContain('canvasVideo')
    expect(feature('canvasVideo').detail).toMatch(/YouTube/i)
  })

  it('reports the canvas as blocked rather than selling it as available', () => {
    // The lookup exists, but YouTube challenges this deployment, so a listener
    // cannot get a single clip today. "Available" would be a claim, not a fact.
    const f = feature('canvasVideo')
    expect(f.status).toBe(STATUS.blocked)
    expect(f.claim).toMatch(/session/i)
    expect(f.detail).toMatch(/signed-in|sign in/i)
    expect(f.detail).toMatch(/artwork/i)
    // And it says how it comes back: the health check, not a user setting.
    expect(f.detail).toMatch(/health/i)
  })

  it('counts only what actually ships', () => {
    const s = summary()
    expect(s.total).toBe(FEATURES.length)
    expect(s.available).toBe(
      FEATURES.filter((f) => f.status === STATUS.available || f.status === STATUS.strength).length
    )
    expect(s.available).toBeLessThan(s.total)
  })
})

describe('describeVisual', () => {
  it('reports a user-disabled canvas as exactly that', () => {
    const d = describeVisual({ enabled: false, style: 'spectrum', liveOK: true })
    expect(d).toMatchObject({ active: false, kind: 'off', reason: 'user_disabled' })
  })

  it('distinguishes real audio data from a simulated fallback', () => {
    expect(describeVisual({ enabled: true, style: 'spectrum', liveOK: true })).toMatchObject({
      active: true,
      kind: 'live',
      reason: 'live_audio',
    })
    expect(describeVisual({ enabled: true, style: 'spectrum', liveOK: false })).toMatchObject({
      active: true,
      kind: 'simulated',
      reason: 'live_audio_unavailable',
    })
    expect(describeVisual({ enabled: true, style: 'wave', liveOK: true })).toMatchObject({
      kind: 'simulated',
      reason: 'style_simulated',
    })
  })

  it('says out loud that Data Saver does not suppress a local canvas', () => {
    // The rule is "gate the fetch, not the display". This canvas has no fetch,
    // so hiding it would take a feature away and save nothing.
    const d = describeVisual({ enabled: true, style: 'spectrum', liveOK: true })
    expect(d.active).toBe(true)
    expect(d.dataSaverApplies).toBe(false)
  })
})

describe('mediaPlan', () => {
  const qualities = ['12kbps', '48kbps', '96kbps', '160kbps', '320kbps']

  it('honours the preference when the saver is off', () => {
    expect(mediaPlan({ dataSaver: false, qualityPref: '160kbps', qualities })).toMatchObject({
      quality: '160kbps',
      artwork: 'full',
      reasons: [],
    })
  })

  it('drops to the lowest tier and small artwork when the saver is on', () => {
    expect(mediaPlan({ dataSaver: true, qualityPref: '320kbps', qualities })).toMatchObject({
      quality: '12kbps',
      artwork: 'small',
      reasons: ['data_saver_on'],
    })
  })

  it('still returns a sane quality with no list to choose from', () => {
    expect(mediaPlan({ dataSaver: true, qualityPref: '320kbps' }).quality).toBe('12kbps')
  })
})

describe('user-facing copy', () => {
  // Acceptance rule: no claim of lossless, skip-silence or canvas video may
  // appear in the UI. Every mention of one of those words in a component has
  // to be a denial, so the heuristic is "the same line also says no/not/n't".
  const DENIAL = /(no |not |n't|never|unavailable|without|instead)/i

  it('only ever mentions an unobtainable feature in order to deny it', () => {
    const offenders = []
    for (const file of walk(SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        // Comments are allowed to discuss the topic; only shipped strings matter.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        if (!/lossless|skip silence/i.test(line)) return
        if (!DENIAL.test(line)) offenders.push(`${file.replace(SRC, 'src/components')}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
