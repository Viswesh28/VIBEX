/**
 * Studio Web Audio DSP Engine for VIBEX v3.0:
 * - 10-band graphic/parametric EQ (32 Hz -> 16 kHz, -12 dB to +12 dB)
 * - Smart Loudness Normalization (broadcast-style DynamicsCompressorNode + makeup gain)
 * - Algorithmic Stereo Hall Convolver Reverb ("Slowed + Reverb" & Studio Room modes)
 * - Playback rate (0.75x - 1.50x) + independent pitch preservation control
 */

export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

export const EQ_LABELS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k']

export const EQ_BANDS = EQ_FREQUENCIES.map((freq, idx) => ({
  freq,
  label: EQ_LABELS[idx],
}))

export const EQ_PRESETS = {
  flat: {
    label: 'Flat',
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  bass_boost: {
    label: 'Bass Boost',
    gains: [6.5, 5.5, 4.0, 1.5, 0, -0.5, 0, 0.5, 1.0, 1.5],
  },
  vocal_clarity: {
    label: 'Vocal Clarity',
    gains: [-2.0, -1.5, -0.5, 1.5, 3.5, 4.5, 4.0, 2.5, 1.0, 0.5],
  },
  acoustic: {
    label: 'Acoustic',
    gains: [3.5, 3.0, 1.5, 0.5, 1.5, 2.0, 3.0, 3.5, 3.0, 2.0],
  },
  electronic: {
    label: 'Electronic',
    gains: [5.5, 4.5, 1.5, -1.0, -1.5, 1.0, 2.5, 4.0, 4.5, 5.0],
  },
  rock: {
    label: 'Rock',
    gains: [4.5, 3.5, 2.0, -1.0, -1.5, 1.5, 3.0, 4.0, 4.0, 3.5],
  },
  treble_sparkle: {
    label: 'Treble Sparkle',
    gains: [0, 0, 0, 0, 0.5, 1.5, 3.0, 4.5, 5.5, 6.0],
  },
  late_night: {
    label: 'Late Night',
    gains: [3.0, 2.5, 1.0, 0.5, 1.5, 2.0, 1.0, -1.5, -2.5, -3.5],
  },
}

export const DEFAULT_DSP = {
  eqOn: true,
  eqPreset: 'flat',
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  loudnessNorm: false,
  playbackRate: 1,
  preservePitch: true,
  reverbMix: 0,
  slowedReverb: false,
}

export function clampEqGains(gains) {
  if (!Array.isArray(gains)) return [...EQ_PRESETS.flat.gains]
  return EQ_FREQUENCIES.map((_, i) => {
    const v = Number(gains[i])
    if (!Number.isFinite(v)) return 0
    return Math.round(Math.max(-12, Math.min(12, v)) * 2) / 2
  })
}

export function effectiveDspParams(dsp = DEFAULT_DSP) {
  if (dsp?.slowedReverb) {
    return {
      eqOn: dsp.eqOn !== false,
      eqGains: clampEqGains(dsp.eqGains),
      loudnessNorm: Boolean(dsp.loudnessNorm),
      playbackRate: dsp.playbackRate && dsp.playbackRate !== 1 ? dsp.playbackRate : 0.84,
      preservePitch: false,
      reverbMix: dsp.reverbMix > 0 ? dsp.reverbMix : 0.38,
    }
  }
  return {
    eqOn: dsp?.eqOn !== false,
    eqGains: clampEqGains(dsp?.eqGains),
    loudnessNorm: Boolean(dsp?.loudnessNorm),
    playbackRate: Math.max(0.5, Math.min(2, Number(dsp?.playbackRate) || 1)),
    preservePitch: dsp?.preservePitch !== false,
    reverbMix: Math.max(0, Math.min(0.75, Number(dsp?.reverbMix) || 0)),
  }
}

/** Synthesize a clean stereo studio hall impulse response without external files. */
export function createHallImpulse(ctx, seconds = 2.1, decay = 2.8) {
  if (!ctx || typeof ctx.createBuffer !== 'function') return null
  const rate = ctx.sampleRate || 44100
  const length = Math.max(1, Math.floor(rate * seconds))
  const impulse = ctx.createBuffer(2, length, rate)
  for (let ch = 0; ch < 2; ch += 1) {
    const data = impulse.getChannelData(ch)
    let seed = ch === 0 ? 0x1234567 : 0x89abcdef
    for (let i = 0; i < length; i += 1) {
      // Deterministic PRNG so audio tests are fast and repeatable.
      seed = (seed * 1664525 + 1013904223) >>> 0
      const white = (seed / 0xffffffff) * 2 - 1
      const env = Math.pow(1 - i / length, decay)
      data[i] = white * env * 0.55
    }
  }
  return impulse
}

/**
 * Construct the Web Audio DSP processing bus between deck inputs and analyser:
 * input -> [10-band BiquadFilter EQ] -> [Dry + Convolver Wet] -> [Loudness Compressor + Makeup] -> output
 */
export function createAudioDspChain(ctx) {
  if (
    !ctx ||
    typeof ctx.createGain !== 'function' ||
    typeof ctx.createBiquadFilter !== 'function'
  ) {
    return null
  }

  const input = ctx.createGain()
  const output = ctx.createGain()

  const filters = EQ_FREQUENCIES.map((freq, idx) => {
    const f = ctx.createBiquadFilter()
    f.type = idx === 0 ? 'lowshelf' : idx === EQ_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking'
    f.frequency.value = freq
    f.Q.value = 1.15
    f.gain.value = 0
    return f
  })

  for (let i = 0; i < filters.length - 1; i += 1) {
    filters[i].connect(filters[i + 1])
  }

  const dryGain = ctx.createGain()
  const wetGain = ctx.createGain()
  dryGain.gain.value = 1
  wetGain.gain.value = 0

  let convolver = null
  if (typeof ctx.createConvolver === 'function') {
    try {
      convolver = ctx.createConvolver()
      const ir = createHallImpulse(ctx)
      if (ir) convolver.buffer = ir
    } catch {
      convolver = null
    }
  }

  const mixBus = ctx.createGain()
  input.connect(filters[0])
  const lastFilter = filters[filters.length - 1]
  lastFilter.connect(dryGain)
  dryGain.connect(mixBus)

  if (convolver) {
    lastFilter.connect(convolver)
    convolver.connect(wetGain)
    wetGain.connect(mixBus)
  }

  let compressor = null
  const normBypassGain = ctx.createGain()
  const normActiveGain = ctx.createGain()
  normBypassGain.gain.value = 1
  normActiveGain.gain.value = 0

  if (typeof ctx.createDynamicsCompressor === 'function') {
    try {
      compressor = ctx.createDynamicsCompressor()
      compressor.threshold.value = -20
      compressor.knee.value = 24
      compressor.ratio.value = 3.5
      compressor.attack.value = 0.006
      compressor.release.value = 0.25
    } catch {
      compressor = null
    }
  }

  mixBus.connect(normBypassGain)
  normBypassGain.connect(output)

  if (compressor) {
    mixBus.connect(compressor)
    compressor.connect(normActiveGain)
    normActiveGain.connect(output)
  }

  return {
    ctx,
    input,
    output,
    bands: filters,
    filters,
    dryGain,
    wetGain,
    convolver,
    compressor,
    normBypassGain,
    normActiveGain,
  }
}

export function applyAudioDspChain(chain, dsp = DEFAULT_DSP) {
  if (!chain) return
  const t = chain.ctx?.currentTime ?? 0
  const setParam = (param, val) => {
    if (!param) return
    param.value = val
    if (typeof param.setValueAtTime === 'function') {
      try {
        param.setValueAtTime(val, t)
      } catch {
        /* ignore */
      }
    }
  }
  const eff = effectiveDspParams(dsp)
  chain.filters.forEach((f, idx) => {
    const g = eff.eqOn ? eff.eqGains[idx] || 0 : 0
    setParam(f.gain, g)
  })

  if (chain.convolver) {
    setParam(chain.wetGain.gain, eff.reverbMix)
    setParam(chain.dryGain.gain, Math.max(0.55, 1 - eff.reverbMix * 0.35))
  }

  if (chain.compressor) {
    setParam(chain.normActiveGain.gain, eff.loudnessNorm ? 1.22 : 0)
    setParam(chain.normBypassGain.gain, eff.loudnessNorm ? 0 : 1)
  }
}

export const applyDspSettings = applyAudioDspChain

export function applyDeckPlaybackRate(el, dsp = DEFAULT_DSP) {
  if (!el) return
  const eff = effectiveDspParams(dsp)
  try {
    if (el.playbackRate !== eff.playbackRate) {
      el.playbackRate = eff.playbackRate
    }
    if ('preservesPitch' in el) el.preservesPitch = eff.preservePitch
    else if ('webkitPreservesPitch' in el) el.webkitPreservesPitch = eff.preservePitch
    else if ('mozPreservesPitch' in el) el.mozPreservesPitch = eff.preservePitch
  } catch {
    /* ignore detached media element */
  }
}
