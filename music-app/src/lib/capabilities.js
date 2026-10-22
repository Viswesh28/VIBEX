/**
 * What VIBEX can and cannot do — one honest list, in one place.
 *
 * The rule this module exists to enforce: never let the UI imply a capability
 * the source cannot supply. VIBEX has exactly one source (JioSaavn), and three
 * things people reasonably expect from a music player are simply not on offer
 * there — lossless audio, skip-silence, and beat-matched transitions. A second
 * source would not fix any of them either; they need a lossless tier that does
 * not exist or local DSP on the audio file.
 *
 * So "available" below means "the catalogue actually serves this", "strength"
 * means "better here than in a multi-source player", and "unavailable" means
 * "no setting, no pin, no automatic mode will ever produce it". Copy here is
 * asserted by test/capabilities.spec.js, including the negative form: a
 * component may mention lossless only in a sentence that denies it.
 */

/** The one source. Kept as an object so a future second source has a shape. */
export const SOURCE = {
  id: 'jiosaavn',
  label: 'JioSaavn',
  maxKbps: 320,
  format: 'AAC in MP4',
  /** Saavn media URLs carry no expiry, which is why offline works well here. */
  expiringUrls: false,
}

export const STATUS = {
  /** The catalogue serves this today. */
  available: 'available',
  /** Genuinely better here than in a cross-source player. */
  strength: 'strength',
  /** Needs work that has not shipped; the feature is not faked. */
  local: 'local',
  /** No source in this app can supply it, now or later. */
  unavailable: 'unavailable',
  /**
   * Shipped, but this deployment cannot reach it. Distinct from `unavailable`
   * because the code is real and self-healing: the only thing standing between
   * the listener and the feature is a challenge from the provider, not a
   * missing capability. Reported rather than hidden — a silent failure here
   * would be a claim by omission.
   */
  blocked: 'blocked',
}

/**
 * The matrix. `claim` is the short form shown on the row; `detail` is the
 * second line, shown on expand. Never add an entry with STATUS.available for
 * something that needs a second provider.
 */
export const FEATURES = [
  {
    id: 'playback',
    label: 'Playback',
    status: STATUS.available,
    claim: 'Streams from JioSaavn',
    detail: 'Same-origin /api. No keys, no accounts, no third-party player.',
  },
  {
    id: 'quality',
    label: 'Audio quality',
    status: STATUS.available,
    claim: 'Up to 320 kbps AAC',
    detail: `That is the ceiling — ${SOURCE.format}, ${SOURCE.maxKbps} kbps. There is no higher tier to unlock.`,
  },
  {
    id: 'lossless',
    label: 'Lossless audio',
    status: STATUS.unavailable,
    claim: 'Not available',
    detail: 'JioSaavn has no lossless tier, so the 320 kbps AAC file is the best there is.',
  },
  {
    id: 'skipSilence',
    label: 'Skip silence',
    status: STATUS.unavailable,
    claim: 'Not available',
    detail: 'The catalogue does not provide segment data, and VIBEX does not analyse audio to find gaps.',
  },
  {
    id: 'canvasVideo',
    label: 'Canvas video',
    status: STATUS.blocked,
    claim: 'Needs a YouTube session',
    detail:
      'A cross-source extra: audio stays on JioSaavn and only the looping clip would come from YouTube. YouTube will not describe a music track to a client without a signed-in session, and this server has none, so the web player shows artwork. The Android app has a second route — it asks the track\'s own page on your device — which is built but not yet confirmed on a handset.',
  },
  {
    id: 'beatMatch',
    label: 'Beat-matched transitions',
    status: STATUS.local,
    claim: 'Needs local analysis',
    detail: 'Neither the catalogue nor the stream exposes tempo or key. VIBEX refuses to mix rather than guessing.',
  },
  {
    id: 'crossfade',
    label: 'Crossfade and gapless',
    status: STATUS.available,
    claim: 'Equal-power, linear or bass-swap',
    detail: '0–12s, scheduled on the audio clock. A gapless hand-over is a separate, exact cut.',
  },
  {
    id: 'sources',
    label: 'Second source',
    status: STATUS.blocked,
    claim: 'YT Music: browse here, play in YouTube’s embed',
    detail:
      'YouTube Music can be browsed and searched. Nothing is extracted anywhere: every YouTube item opens in YouTube’s own player, on the web and in the app alike, because YouTube will not serve its audio to a server or to a foreign origin. That means YouTube’s video and ads rather than our audio-only transport, so JioSaavn stays the source that plays as audio, and it is the default.',
  },
  {
    id: 'offline',
    label: 'Offline downloads',
    status: STATUS.strength,
    claim: 'Keep working indefinitely',
    detail: 'Saavn media URLs carry no expiry, so a downloaded file never has to be re-resolved.',
  },
]

/** Features whose absence must never be papered over. */
export const NEVER_CLAIM = ['lossless', 'skipSilence']

/**
 * Capabilities that depend on a second provider rather than the catalogue.
 * Kept explicit so "one source" never turns into a false claim about the app.
 */
export const CROSS_SOURCE = ['canvasVideo']

/** One row by id, or null. */
export function feature(id) {
  return FEATURES.find((f) => f.id === id) || null
}

/** Counts for a compact "N of M" summary line. */
export function summary() {
  const available = FEATURES.filter(
    (f) => f.status === STATUS.available || f.status === STATUS.strength
  ).length
  return { available, total: FEATURES.length }
}

/**
 * Why the visualiser is in the state it is in, as a machine-readable reason.
 *
 * Data Saver deliberately does not appear as a suppressant: the canvas is
 * drawn from an analyser on already-downloaded audio, so hiding it would save
 * no bytes and only take away a feature the user asked for. The `dataSaver`
 * flag is returned explicitly so a caller can *show* that reasoning instead of
 * leaving the question open.
 */
export function describeVisual({ enabled = false, style = 'spectrum', liveOK = false } = {}) {
  if (!enabled) {
    return {
      active: false,
      kind: 'off',
      reason: 'user_disabled',
      note: 'Canvas animations are off.',
    }
  }
  if (style === 'spectrum' && liveOK) {
    return {
      active: true,
      kind: 'live',
      reason: 'live_audio',
      dataSaverApplies: false,
      note: 'Real frequency data from the audio stream.',
    }
  }
  if (style === 'spectrum') {
    return {
      active: true,
      kind: 'simulated',
      reason: 'live_audio_unavailable',
      dataSaverApplies: false,
      note: 'Live spectrum unavailable here — drawing a simulated animation instead.',
    }
  }
  return {
    active: true,
    kind: 'simulated',
    reason: 'style_simulated',
    dataSaverApplies: false,
    note: 'Simulated animation (no audio analysis).',
  }
}

/**
 * What Data Saver actually changes. One resolver, so quality and artwork can
 * never disagree about whether the saver is on.
 */
export function mediaPlan({ dataSaver = false, qualityPref = '320kbps', qualities = [] } = {}) {
  const lowest = qualities.length ? qualities[0] : '12kbps'
  if (!dataSaver) {
    return { quality: qualityPref, artwork: 'full', reasons: [] }
  }
  return {
    quality: lowest,
    artwork: 'small',
    reasons: ['data_saver_on'],
  }
}
