// ==========================================================================
// Transition engine — pure maths + the planner.
// --------------------------------------------------------------------------
// Everything the player decides *about* a hand-over lives here as a pure
// function, so it can be unit-tested without an audio device. PlayerContext
// only executes the plan.
//
// Three rules from the research these functions encode:
//
//  1. Cheapest acceptable transition first. A cut is better than a crossfade
//     that fights the material, and a crossfade is better than a beat-matched
//     blend that only *nearly* lines up.
//  2. Manual skip bypasses the fancy path. A DJ-style blend is a
//     play-through behaviour; the user already told you they want the next
//     track now.
//  3. Refusals are explicit and typed. "We did not mix this pair" is data the
//     UI can explain, not a silent downgrade.
// ==========================================================================

/** Crossfade laws the player can execute. */
export const CROSSFADE_LAWS = ['equalPower', 'bassSwap', 'linear']

export const LAW_LABELS = {
  equalPower: 'Equal power',
  bassSwap: 'Bass swap',
  linear: 'Linear',
}

export const LAW_HINTS = {
  equalPower:
    'Cosine/sine: loudness stays flat through the overlap. The right default for two unrelated recordings.',
  bassSwap:
    'Equal power plus a low-band hand-off, so two kick drums never share the same 60 Hz. Equal power when the analyser is unavailable.',
  linear:
    'Straight amplitude ramp for correlated material — the same recording, a stem, or a reprise.',
}

export const MIN_CROSSFADE_SEC = 0
export const MAX_CROSSFADE_SEC = 12
export const DEFAULT_CROSSFADE_SEC = 5
/** Short, law-independent hand-over used for a user-initiated skip. */
export const MANUAL_SKIP_SEC = 0.35

export const clamp01 = (e) => {
  const n = Number(e)
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

export function normaliseLaw(law) {
  return CROSSFADE_LAWS.includes(law) ? law : 'equalPower'
}

/**
 * Amplitude pair for a crossfade law at ramp position `e` (0 = old track only,
 * 1 = new track only).
 *
 * equalPower: cos/sin, so out² + in² = 1 — constant *power*, the correct law
 * for two decorrelated recordings.
 * linear: 1 − e / e — constant amplitude, which is what correlated material
 * needs; use it only for like-for-like pairs.
 * bassSwap: the gain legs are equal-power; the low band is handed over
 * separately by `bassSwapDb`.
 */
export function fadeGains(law, e) {
  const t = clamp01(e)
  if (normaliseLaw(law) === 'linear') return { out: 1 - t, in: t }
  return { out: Math.cos((t * Math.PI) / 2), in: Math.sin((t * Math.PI) / 2) }
}

/**
 * Low-band trims (dB) for the bass-swap law: cut the outgoing low end fast,
 * bring the incoming one in late. The two curves cross at −6 dB so the total
 * low-band energy never doubles up.
 */
export function bassSwapDb(e) {
  const t = clamp01(e)
  const out = -40 * Math.pow(t, 0.55)
  const inDb = -40 * Math.pow(1 - t, 1.8)
  return { out: Math.max(-40, out), in: Math.max(-40, inDb) }
}

/**
 * A `steps`-point curve for one leg, ready for `AudioParam.setValueCurveAtTime`.
 * `leg` is 'out' (1 → 0) or 'in' (0 → 1).
 */
export function rampCurve(law, leg, steps = 64) {
  const n = Math.max(2, Math.round(steps))
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const g = fadeGains(law, i / (n - 1))
    curve[i] = leg === 'in' ? g.in : g.out
  }
  return curve
}

// --- transitions ----------------------------------------------------------

export const TRANSITION = {
  hardCut: 'hard_cut',
  trimSilence: 'trim_silence',
  crossfade: 'crossfade',
  filteredCrossfade: 'filtered_crossfade',
  beatMatched: 'beat_matched',
  phraseBlend: 'phrase_blend',
}

export const TRANSITION_LABELS = {
  hard_cut: 'Cut',
  trim_silence: 'Gapless',
  crossfade: 'Crossfade',
  filtered_crossfade: 'Filtered crossfade',
  beat_matched: 'Beat-matched',
  phrase_blend: 'Phrase blend',
}

/** Typed reasons a richer transition was refused. Copy this list; don't prose it. */
export const REFUSAL = {
  manualSkip: 'manual_skip',
  crossfadeOff: 'crossfade_off',
  gaplessOnly: 'gapless_only',
  noAnalysis: 'no_analysis',
  sequentialAlbum: 'sequential_album',
  lossless: 'lossless_path',
  localContent: 'local_content',
  tempoMismatch: 'tempo_mismatch',
  lowConfidence: 'low_confidence',
  keyClash: 'key_clash',
}

export const REFUSAL_LABELS = {
  manual_skip: 'You skipped — a cut is what you asked for',
  crossfade_off: 'Crossfade is off',
  gapless_only: 'Gapless only (0 s overlap)',
  no_analysis: 'No tempo/key analysis for this track',
  sequential_album: 'Albums play as the artist sequenced them',
  lossless_path: 'Lossless path — no DSP budget for mixing',
  local_content: 'Local or uploaded audio is not analysed',
  tempo_mismatch: 'Tempos are too far apart to stretch',
  low_confidence: 'Tempo confidence too low to align',
  key_clash: 'Keys clash on the Camelot wheel',
}

export const DEFAULT_PLAN_CFG = {
  /** ±4 % is the safe beat-match window; beyond it, artefacts win. */
  maxStretch: 0.04,
  minConfidence: 0.6,
  /** Never start a blend across a drop or in the last seconds of a track. */
  dropGuardSec: 4,
  /** How many bars of the outgoing track a blend may consume. */
  tailBars: 8,
  phraseBars: 8,
  fallbackSec: DEFAULT_CROSSFADE_SEC,
  /** More than this much dead air on either side means "trim, don't blend". */
  silenceThreshold: 10,
}

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback)

/**
 * Camelot-wheel distance. 0 = same key, 1 = neighbour or relative major/minor.
 * `Infinity` means "we could not read a key", which callers must treat as
 * incompatible rather than compatible.
 */
export function camelotDistance(a, b) {
  const parse = (code) => {
    const m = /^\s*(\d{1,2})\s*([AB])\s*$/i.exec(String(code || ''))
    if (!m) return null
    const n = Number(m[1])
    if (!(n >= 1 && n <= 12)) return null
    return { n, letter: m[2].toUpperCase() }
  }
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return Infinity
  const raw = Math.abs(x.n - y.n)
  const wheel = Math.min(raw, 12 - raw)
  // Same number, other letter = relative major/minor: harmonically next door.
  return wheel + (x.letter === y.letter ? 0 : 1)
}

/**
 * Where in `a` a blend should begin: a phrase boundary, near the tail, never
 * inside the guarded window before the end (which is where drops live).
 */
export function pickPhraseBoundary(analysis, cfg = {}) {
  const c = { ...DEFAULT_PLAN_CFG, ...cfg }
  const end = num(analysis?.end)
  const barLength = num(analysis?.barLength, 4)
  const bpm = num(analysis?.bpm)
  const barSec = bpm > 0 ? (60 / bpm) * barLength : 2
  const latest = Math.max(0, end - c.dropGuardSec)
  const earliest = Math.max(0, end - c.tailBars * barSec)
  const starts = Array.isArray(analysis?.phraseStarts) ? analysis.phraseStarts : []
  const usable = starts
    .map((s) => num(s))
    .filter((s) => s >= earliest && s <= latest)
    .sort((x, y) => y - x)
  if (usable.length) return usable[0]
  return Math.max(0, latest - c.phraseBars * barSec)
}

/**
 * Decide how to hand over from track A to track B.
 *
 * Returns a plan the player can execute or explain:
 *   { type, law, lengthSec, atSec, rate, reason, refusals }
 *
 * `reason` is the *dominant* reason and `refusals` is the full list, so the UI
 * can say "crossfade — tempos too far apart" instead of just "crossfade".
 */
export function planTransition({
  a = null,
  b = null,
  law = 'equalPower',
  crossfadeOn = true,
  crossfadeSec = DEFAULT_CROSSFADE_SEC,
  manualSkip = false,
  sequentialAlbum = false,
  lossless = false,
  local = false,
  cfg = {},
} = {}) {
  const c = { ...DEFAULT_PLAN_CFG, ...cfg }
  const refusals = []
  const sec = Math.max(MIN_CROSSFADE_SEC, Math.min(MAX_CROSSFADE_SEC, num(crossfadeSec, c.fallbackSec)))
  const chosenLaw = normaliseLaw(law)
  const cut = (reason, extra = {}) => ({
    type: TRANSITION.hardCut,
    law: chosenLaw,
    lengthSec: 0,
    atSec: num(a?.end),
    rate: 1,
    reason,
    refusals,
    ...extra,
  })

  // 1. Manual skip: the user's gesture outranks any blend.
  if (manualSkip) {
    refusals.push(REFUSAL.manualSkip)
    return cut(REFUSAL.manualSkip)
  }

  // 2. Crossfade disabled, or the user asked for gapless.
  if (!crossfadeOn) {
    refusals.push(REFUSAL.crossfadeOff)
    return cut(REFUSAL.crossfadeOff)
  }
  if (sec <= 0) {
    refusals.push(REFUSAL.gaplessOnly)
    return cut(REFUSAL.gaplessOnly)
  }

  // 3. Dead air on either side: trim it and hand over gaplessly. Cheaper and
  //    cleaner than any ramp.
  const tailSilence = num(a?.tailSilence)
  const leadSilence = num(b?.leadSilence)
  if (tailSilence > c.silenceThreshold || leadSilence > c.silenceThreshold) {
    return {
      type: TRANSITION.trimSilence,
      law: 'linear',
      lengthSec: 0,
      atSec: Math.max(0, num(a?.end) - tailSilence),
      rate: 1,
      reason: 'silence',
      refusals,
    }
  }

  // 4. AutoMix eligibility. Anything that makes the pair unanalysable is a
  //    refusal, not an error.
  if (sequentialAlbum) refusals.push(REFUSAL.sequentialAlbum)
  if (lossless) refusals.push(REFUSAL.lossless)
  if (local) refusals.push(REFUSAL.localContent)
  const eligible = a && b && !sequentialAlbum && !lossless && !local
  const hasTempo = Number.isFinite(Number(a?.bpm)) && Number.isFinite(Number(b?.bpm))
  const analysable = eligible && hasTempo
  const confA = num(a?.bpmConfidence)
  const confB = num(b?.bpmConfidence)
  const confident = analysable && confA > c.minConfidence && confB > c.minConfidence
  if (!analysable) refusals.push(REFUSAL.noAnalysis)
  else if (!confident) refusals.push(REFUSAL.lowConfidence)

  if (confident) {
    const bpmA = num(a.bpm)
    const bpmB = num(b.bpm)
    const delta = bpmA > 0 ? Math.abs(bpmA - bpmB) / bpmA : Infinity
    const keyDist = camelotDistance(a.key?.camelot, b.key?.camelot)
    const canStretch = delta <= c.maxStretch
    const keyOK = keyDist <= 1

    if (!canStretch) {
      refusals.push(REFUSAL.tempoMismatch)
      // A wild tempo/key pairing still benefits from a filtered hand-over:
      // it masks the seam without pretending the beats line up.
      return {
        type: TRANSITION.filteredCrossfade,
        law: chosenLaw,
        lengthSec: sec,
        atSec: Math.max(0, num(a.end) - sec),
        rate: 1,
        filter: { kind: 'lowpass', hz: 1200 },
        reason: REFUSAL.tempoMismatch,
        refusals,
      }
    }
    if (!keyOK) refusals.push(REFUSAL.keyClash)

    const atSec = pickPhraseBoundary(a, c)
    return {
      type: keyOK ? TRANSITION.beatMatched : TRANSITION.filteredCrossfade,
      law: keyOK ? chosenLaw : chosenLaw,
      lengthSec: sec,
      atSec,
      rate: bpmA > 0 ? bpmB / bpmA : 1,
      lengthBars: 8,
      eq: { outLowGainDb: [-0, -6, -40], inLowGainDb: [-40, -6, 0] },
      reason: keyOK ? 'tempo_and_key_match' : REFUSAL.keyClash,
      refusals,
    }
  }

  // 5. The normal case: a well-behaved crossfade with the user's law.
  return {
    type: TRANSITION.crossfade,
    law: chosenLaw,
    lengthSec: sec,
    atSec: Math.max(0, num(a?.end) - sec),
    rate: 1,
    reason: 'crossfade',
    refusals,
  }
}

/**
 * Should the player even attempt to blend this track into the next?
 * Separate from planTransition so the UI can explain a de-featured hand-over
 * before it happens.
 */
export function canAutoMix({ analysis, sequentialAlbum, lossless, local, manualSkip, cfg = {} } = {}) {
  const c = { ...DEFAULT_PLAN_CFG, ...cfg }
  if (manualSkip) return { ok: false, reason: REFUSAL.manualSkip }
  if (sequentialAlbum) return { ok: false, reason: REFUSAL.sequentialAlbum }
  if (lossless) return { ok: false, reason: REFUSAL.lossless }
  if (local) return { ok: false, reason: REFUSAL.localContent }
  if (!analysis || !Number.isFinite(Number(analysis.bpm))) return { ok: false, reason: REFUSAL.noAnalysis }
  if (Number(analysis.bpmConfidence) <= c.minConfidence)
    return { ok: false, reason: REFUSAL.lowConfidence }
  return { ok: true, reason: null }
}

/** One-line explanation for the "Mixing" badge / settings hint. */
export function describePlan(plan) {
  if (!plan) return ''
  const label = TRANSITION_LABELS[plan.type] || 'Transition'
  if (plan.type === TRANSITION.hardCut) return `${label} — ${REFUSAL_LABELS[plan.reason] || plan.reason}`
  if (plan.type === TRANSITION.trimSilence) return `${label} — trimmed dead air`
  if (plan.type === TRANSITION.filteredCrossfade) return `Filtered crossfade — ${REFUSAL_LABELS[plan.reason] || plan.reason}`
  if (plan.lengthBars) return `${label} — ${plan.lengthBars} bars`
  return `${label} — ${Math.round(plan.lengthSec)}s`
}
