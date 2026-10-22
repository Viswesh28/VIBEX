// ==========================================================================
// Recommendation ladder — one explicit state machine, not a pile of ifs.
// --------------------------------------------------------------------------
// When a track ends there are exactly five things the player can do. Naming
// all five — and naming every way the recommender can *fail* — is what stops
// "the queue just stopped" from being an unexplained dead end.
//
//   IN_CONTEXT → SMART_INSERT → AUTOPLAY_TAIL → SEED_RADIO → STOP
//
// The insertions are a side channel: they are marked with provenance and
// rendered with a badge, never written into the user's playlist.
// ==========================================================================

export const NEXT = {
  inContext: 'in_context',
  smartInsert: 'smart_insert',
  autoplay: 'autoplay',
  radio: 'radio',
  stop: 'stop',
}

/** Why an item is in the queue. Attached to the song as `_prov`. */
export const REC_REASON = {
  sameArtist: 'same_artist',
  playlistCooccurrence: 'playlist_cooccurrence',
  audioSimilarity: 'audio_similarity',
  editorial: 'editorial',
  context: 'context',
}

export const REC_REASON_LABEL = {
  same_artist: 'Same artist',
  playlist_cooccurrence: 'From a playlist you play',
  audio_similarity: 'Sounds like what you were playing',
  editorial: 'Picked by VIBEX',
  context: 'Continues this mix',
}

export const REC_REASON_SENTENCE = {
  same_artist: 'More from this artist',
  playlist_cooccurrence: 'Because these songs keep company',
  audio_similarity: 'Because it sounds like the last track',
  editorial: 'Picked for you',
  context: 'Continues this mix',
}

/** Typed stop reasons — each one should map to a different recovery. */
export const STOP_REASON = {
  contextExhausted: 'context_exhausted',
  autoplayFailed: 'autoplay_failed',
  formatNegotiationFailed: 'format_negotiation_failed',
  entitlementLapsed: 'entitlement_lapsed',
  contentNotPlayable: 'content_not_playable',
  clientTooOld: 'client_too_old',
  unknown: 'unknown',
}

export const STOP_LABEL = {
  context_exhausted: 'Queue finished',
  autoplay_failed: "Couldn't find anything similar — autoplay stopped",
  format_negotiation_failed: "Your browser couldn't play this stream",
  entitlement_lapsed: 'This track is no longer available',
  content_not_playable: 'This track is not playable right now',
  client_too_old: 'The music service rejected this client',
  unknown: 'Playback stopped',
}

export const DEFAULT_REC = {
  /** One suggestion per N user tracks. A budget, not a vibe. */
  insertEvery: 3,
  /** Never insert into a short context — that is just interrupting. */
  minTracks: 15,
  /** Sessions explore 3–10 % of the time, per the bandit literature. */
  explore: 0.06,
  /** A skip before this many seconds is a strong negative signal. */
  earlySkipSec: 30,
  /** An explicit dismiss is honoured for this long, across sessions. */
  dismissDays: 30,
}

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback)
const int = (v, fallback = 0) => Math.trunc(num(v, fallback))

/** How many recommendations a context of this length may take. */
export function insertBudget(trackCount, cfg = {}) {
  const c = { ...DEFAULT_REC, ...cfg }
  const n = int(trackCount)
  if (n <= c.minTracks) return 0
  return Math.max(0, Math.floor(n / c.insertEvery))
}

/** ε-greedy exploration check. Injected randomness keeps this testable. */
export function shouldExplore(epsilon = DEFAULT_REC.explore, rand = Math.random) {
  const e = num(epsilon)
  if (!(e > 0)) return false
  return rand() < e
}

/**
 * The one decision the player makes when a track ends.
 *
 * `candidate` is a song the caller already fetched (or null when the pool is
 * empty). Keeping the fetch out of this function is what lets the ladder be
 * tested without a network.
 */
export function decideNext({
  queueLength = 0,
  index = -1,
  repeat = 'all',
  shuffle = 'off',
  smartShuffle = false,
  autoplay = false,
  radio = false,
  insertsUsed = 0,
  originalLength = null,
  candidate = null,
  reason = REC_REASON.sameArtist,
  autoplayFailed = false,
  radioFailed = false,
  cfg = {},
} = {}) {
  const c = { ...DEFAULT_REC, ...cfg }
  const n = int(queueLength)
  const i = int(index)

  // Nothing to continue from. This is a *context* failure, not a
  // recommendation failure: different UI, different retry.
  if (n <= 0 || i < 0) return { kind: NEXT.stop, stopReason: STOP_REASON.contextExhausted }

  if (repeat === 'one') return { kind: NEXT.inContext, index: i, loop: true }

  const last = i >= n - 1
  const contextLength = originalLength == null ? n : int(originalLength)

  // Smart Shuffle is an in-context mixer: it only inserts while there are
  // still user tracks to come.
  if (shuffle === 'on' && !smartShuffle) return { kind: NEXT.inContext, shuffle: true }

  if (!last && smartShuffle) {
    const budget = insertBudget(contextLength, c)
    if (insertsUsed < budget && candidate) {
      return { kind: NEXT.smartInsert, item: candidate, reason }
    }
    return { kind: NEXT.inContext, index: i + 1 }
  }

  if (!last) return { kind: NEXT.inContext, index: i + 1 }

  // End of the user's context: wrap, or hand over to the tail.
  if (repeat === 'all') return { kind: NEXT.inContext, index: 0, wrapped: true }

  // Autoplay first, but a failed autoplay falls *through* to radio rather than
  // stopping — that distinction is the whole point of a ladder.
  if (autoplay && !autoplayFailed && candidate) {
    return { kind: NEXT.autoplay, item: candidate, reason }
  }
  if (radio && !radioFailed && candidate) {
    return { kind: NEXT.radio, item: candidate, reason }
  }
  if (autoplay && !autoplayFailed && !candidate) {
    return { kind: NEXT.stop, stopReason: STOP_REASON.autoplayFailed }
  }
  if (radio && !radioFailed && !candidate) {
    return { kind: NEXT.stop, stopReason: STOP_REASON.autoplayFailed }
  }

  return { kind: NEXT.stop, stopReason: STOP_REASON.contextExhausted }
}

/**
 * Score and pick from a candidate pool. Dismissed ids never come back; ids
 * already in the queue are skipped; same-artist and similar-duration songs win.
 */
export function pickCandidate(
  candidates,
  { seed = null, dismissed = null, inQueue = null, rand = Math.random } = {}
) {
  if (!Array.isArray(candidates) || !candidates.length) return null
  const dismissedSet = dismissed instanceof Set ? dismissed : new Set(dismissed || [])
  const queueSet = inQueue instanceof Set ? inQueue : new Set(inQueue || [])
  const seedArtists = artistKeys(seed)
  const seedDur = num(seed?.duration)

  const scored = []
  for (const item of candidates) {
    if (!item || !item.id) continue
    if (!item.downloadUrl?.length) continue
    if (dismissedSet.has(item.id) || queueSet.has(item.id)) continue
    let score = 0.2 + rand() * 0.1
    const artists = artistKeys(item)
    artists.forEach((a) => {
      if (seedArtists.has(a)) score += 0.5
    })
    const dur = num(item.duration)
    if (seedDur > 0 && dur > 0) {
      const diff = Math.abs(dur - seedDur) / seedDur
      if (diff < 0.15) score += 0.2
      else if (diff > 0.6) score -= 0.1
    }
    if (item.album?.id && item.album.id === seed?.album?.id) score += 0.15
    scored.push({ item, score })
  }
  if (!scored.length) return null
  scored.sort((x, y) => y.score - x.score)
  return scored[0].item
}

function artistKeys(song) {
  const out = new Set()
  const primary = song?.artists?.primary || []
  const all = song?.artists?.all || []
  for (const a of [...primary, ...all]) {
    const key = normalise(a?.name || a?.id || '')
    if (key) out.add(key)
  }
  // Subtitle is a credit line ("Anirudh, Someone Else" / "A ft. B"), so each
  // name in it is a separate artist key.
  const sub = String(song?.subtitle || '')
  sub
    .split(/\s*(?:,|&|\/|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b)\s*/i)
    .forEach((part) => {
      const key = normalise(part)
      if (key) out.add(key)
    })
  return out
}

function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(feat|ft|featuring)\b.*$/, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Prune dismissals older than the retention window. Pure so it can run on load
 * and be tested without touching storage.
 */
export function pruneDismissed(map, now = Date.now(), cfg = {}) {
  const c = { ...DEFAULT_REC, ...cfg }
  const cutoff = now - c.dismissDays * 24 * 60 * 60 * 1000
  const out = {}
  Object.entries(map || {}).forEach(([id, at]) => {
    const t = num(at)
    if (t >= cutoff) out[id] = t
  })
  return out
}

export function noteDismissed(map, id, now = Date.now()) {
  if (!id) return { ...(map || {}) }
  return { ...(map || {}), [id]: now }
}

/**
 * Outcome of a track that just ended, used for the implicit half of feedback.
 * `skipped` is only "strong" before the early-skip threshold.
 */
export function playedOutcome({ playedSec = 0, wasRecommendation = false } = {}, cfg = {}) {
  const c = { ...DEFAULT_REC, ...cfg }
  const sec = num(playedSec)
  return {
    success: sec >= c.earlySkipSec,
    strongNegative: wasRecommendation && sec < c.earlySkipSec,
    playedSec: sec,
  }
}
