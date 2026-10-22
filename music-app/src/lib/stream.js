// ==========================================================================
// Stream resilience — typed failures and a recovery ladder.
// --------------------------------------------------------------------------
// A CDN URL can fail for reasons that need completely different responses:
// a 403 from a signed URL needs a fresh URL, an unsupported codec needs a
// lower tier, and a dropped connection needs a retry. Collapsing all of those
// into "playback error, skipping" is why players feel flaky.
// ==========================================================================

export const FAILURE = {
  aborted: 'aborted',
  network: 'network',
  decode: 'decode',
  unsupported: 'format_negotiation_failed',
  staleUrl: 'stale_url',
  blocked: 'blocked',
  unknown: 'unknown',
}

export const FAILURE_LABEL = {
  aborted: 'Load aborted',
  network: 'Network dropped mid-stream',
  decode: 'The audio could not be decoded',
  format_negotiation_failed: "This browser can't play that format",
  stale_url: 'The stream URL expired',
  blocked: 'Playback was blocked by the browser',
  unknown: 'The stream failed',
}

/** Map a MediaError (or anything error-shaped) onto a typed reason. */
export function classifyMediaError(error) {
  const code = error?.code ?? error?.target?.error?.code ?? error?.target?.error
  switch (Number(code)) {
    case 1:
      return FAILURE.aborted
    case 2:
      return FAILURE.network
    case 3:
      return FAILURE.decode
    case 4:
      return FAILURE.unsupported
    default:
      return FAILURE.unknown
  }
}

/** True when a retry could plausibly help; false when the codec cannot work. */
export function isRetryable(reason) {
  return reason === FAILURE.network || reason === FAILURE.aborted || reason === FAILURE.unknown
}

// --- expiring URLs --------------------------------------------------------

/**
 * Read an absolute expiry out of a CDN URL. YouTube-style sources carry
 * `?expire=<unix seconds>`; some CDNs use milliseconds. Returns seconds or
 * null when the URL is not signed.
 */
export function parseExpiry(url) {
  if (typeof url !== 'string' || !url) return null
  let parsed
  try {
    parsed = new URL(url, 'https://local.invalid')
  } catch {
    return null
  }
  const raw = parsed.searchParams.get('expire') || parsed.searchParams.get('expires') || null
  if (raw == null) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  // Anything past ~10^11 is milliseconds.
  return n > 1e11 ? Math.floor(n / 1000) : Math.floor(n)
}

/** Give a URL this much grace before treating it as stale. */
export const EXPIRY_GRACE_SEC = 30

export function isExpired(url, nowMs = Date.now()) {
  const at = parseExpiry(url)
  if (at == null) return false
  return at - EXPIRY_GRACE_SEC <= Math.floor(nowMs / 1000)
}

// --- quality ladder -------------------------------------------------------

const tierOf = (q) => {
  const m = /(\d+)/.exec(String(q || ''))
  return m ? Number(m[1]) : null
}

/**
 * The next usable quality below `current`, given the tiers a song offers
 * (JioSaavn advertises them highest-first). Returns null when there is nothing
 * lower to try.
 */
export function nextQuality(available, current) {
  if (!Array.isArray(available) || !available.length) return null
  const cur = tierOf(current)
  const tiers = available
    .map((d) => ({ quality: typeof d === 'string' ? d : d?.quality, kb: tierOf(typeof d === 'string' ? d : d?.quality) }))
    .filter((d) => d.quality && d.kb != null)
  if (cur == null) return tiers.length ? tiers[tiers.length - 1].quality : null
  const lower = tiers.filter((d) => d.kb < cur).sort((a, b) => b.kb - a.kb)
  return lower.length ? lower[0].quality : null
}

/**
 * Ordered recovery steps for a failed stream. The caller stops at the first
 * step that succeeds.
 *
 *   stale url      → refresh the song's URLs, retry
 *   network/abort  → retry the same URL once
 *   decode/codec   → drop a quality tier
 *   still failing  → give up with a typed reason so the UI can be specific
 */
export function recoveryPlan({ reason, attempt = 0, available = [], quality = null, signed = false } = {}) {
  const steps = []
  const r = reason || FAILURE.unknown
  if (signed || r === FAILURE.staleUrl) steps.push({ action: 'refresh_url' })
  if (attempt < 1 && isRetryable(r)) steps.push({ action: 'retry' })
  const lower = nextQuality(available, quality)
  if (lower) steps.push({ action: 'downgrade', quality: lower })
  steps.push({ action: 'give_up' })
  return steps
}

/** Human sentence for the status line. */
export function failureMessage(reason) {
  return `${FAILURE_LABEL[reason] || FAILURE_LABEL.unknown} — switching.`
}
