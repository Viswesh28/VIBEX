/**
 * Playing a YouTube track by minting its URL on the device.
 *
 * The server cannot do this. A serverless function has no session and a
 * datacenter address, so the player endpoint answers `LOGIN_REQUIRED` — that is
 * measured, not assumed, and it is why YouTube Music has been browse-only since
 * ADR 0003.
 *
 * A page in a WebView is not gated the same way, because it is not pretending
 * to be anything: it is a real YouTube client, on the listener's connection,
 * running YouTube's own script. That script already does the signature
 * decipher and the `n` transform, so the URL the page ends up fetching is one
 * this device is allowed to fetch. We read it and hand it to the native player;
 * the page is then thrown away. The WebView is a **mint**, not a player.
 *
 * Three things this module is deliberate about.
 *
 * 1. A 200 is not proof. Some clients are handed a ~1 MiB prefix of the file,
 *    which plays perfectly and stops a minute in — the worst possible bug,
 *    because it looks like a network hiccup. `validateProbe` refuses a URL
 *    unless the *last* byte is reachable, so a preview becomes a typed
 *    fallback instead of a mystery. See the gate below.
 * 2. The URL is segment-shaped, not file-shaped. It arrives carrying `range=`
 *    and buffer hints that pin a byte window; handed on unchanged, every
 *    request returns the same few hundred KB. `normalizeCapturedUrl` strips
 *    those and keeps the signature.
 * 3. Expiry and network are properties of the URL. `expire=` is usually ~6 h
 *    out, and the signature is bound to the minting address, so a Wi-Fi ⇄
 *    cellular switch invalidates every cached URL at once.
 *
 * Nothing here touches a WebView or a socket. The native side is behind
 * `streamMintBridge()`, and the validity probe's numbers arrive from it, so the
 * whole decision surface is testable in Node — which is the only way it can be
 * tested at all, since this sandbox has no Android SDK.
 *
 * Not a downloader. Nothing here writes a file, re-containers a stream, or
 * keeps bytes after playback stops.
 */

/** Audio-only itags, best first. Opus, then AAC, then the older AAC tiers. */
export const AUDIO_ITAGS = [251, 250, 249, 140, 139]

/** How much of the declared length a URL must be able to serve to be real. */
const FULL_FILE_RATIO = 0.98

/** Bitrate × duration must land within this of the served length. */
const DURATION_RATIO = 0.85

/** A URL is trusted until its own `expire`, less this much clock skew. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000

/** Even a long-lived signature is re-minted after this, and never served stale. */
const MAX_TTL_MS = 4 * 60 * 60 * 1000

/** How a mint attempt may end. Every one of these is a sentence in the UI. */
export const STREAM_STATE = {
  ready: 'ready',
  /** A warm cache answered; no page was loaded. */
  cached: 'cached',
  /** This build has no native mint (a browser tab, or iOS). */
  noBridge: 'no_bridge',
  /** YouTube asked the page to sign in or prove it is not a bot. Terminal. */
  blocked: 'blocked',
  /** The player response described no audio-only rendition. */
  noDirectAudio: 'no_direct_audio',
  /** The page never produced a media request. Terminal for this attempt. */
  noHits: 'no_hits',
  /** The URL serves a prefix of the file and 403s past it. */
  previewTruncated: 'preview_truncated',
  /** The URL would not serve a ranged request at all. */
  notRanged: 'not_ranged',
  /** The tail of the file is not reachable, which previews do exactly here. */
  tailUnreachable: 'tail_unreachable',
  /** Reachable, but too short for its own declared bitrate and duration. */
  shortFile: 'short_file',
  /** Signed URL already dead: 403/410 on the first probe. */
  expired: 'expired',
  /** The bridge threw, or answered with something unreadable. */
  failed: 'failed',
}

export const STREAM_COPY = {
  [STREAM_STATE.noBridge]:
    'This browser cannot reach YouTube audio on its own: YouTube refuses the request and only grants media access to its own pages. Install the VIBEX helper extension, or choose JioSaavn to play.',
  [STREAM_STATE.blocked]:
    'YouTube asked this device to sign in before it would serve the track. Open YouTube Music once in a browser on this device, then try again.',
  [STREAM_STATE.noDirectAudio]:
    'YouTube described this track without an audio-only stream, so it is not played rather than streamed as video.',
  [STREAM_STATE.noHits]:
    'The track page did not start loading any media, so there was nothing to hand the player.',
  [STREAM_STATE.previewTruncated]:
    'YouTube offered only a preview of this track to this device, so it was refused rather than cutting out halfway.',
  [STREAM_STATE.notRanged]:
    'This track URL would not serve the byte ranges playback needs, so it was refused.',
  [STREAM_STATE.tailUnreachable]:
    'This track URL stops before the end of the file, so it was refused rather than cutting out.',
  [STREAM_STATE.shortFile]:
    'This track URL is shorter than the track it claims to be, so it was refused.',
  [STREAM_STATE.expired]:
    'The track URL expired before it could be played. Try again.',
  [STREAM_STATE.failed]: 'This YouTube track could not be resolved on this device.',
}

const failure = (reason, detail) => ({ ok: false, url: null, reason, detail: detail || null })

/**
 * The mint this build can reach, if any.
 *
 * Two shapes, one contract (`mintStream({videoId}) → payload`):
 *
 * * **Android** — the WebView plugin. A real page on the listener's connection,
 *   which is the only thing YouTube will answer.
 * * **A browser extension** — the same idea, but the page is a background tab
 *   and the extension supplies the privilege a web page cannot have. It
 *   installs `__VIBEX_STREAM_MINTER` on our origin; see `extension/`.
 *
 * A plain browser tab gets `null`, and that is not a limitation we can code
 * around: the player endpoint 403s a foreign `Origin` — preflight included —
 * and `googlevideo` only grants CORS to YouTube's own origins. A page cannot
 * read either. So the seam exists, and the extension is what fills it.
 */
export function streamMintBridge(win) {
  const w = win || (typeof window !== 'undefined' ? window : null)

  if (w?.Capacitor?.isNativePlatform?.()) {
    // Android only: WKWebView suspends offscreen media, so an iOS mint would
    // fail invisibly instead of returning a reason.
    if (w.Capacitor.getPlatform?.() !== 'android') return null
    const plugin = w.Capacitor.Plugins?.CanvasMint
    return plugin && typeof plugin.mintStream === 'function' ? plugin : null
  }

  const hook = w?.__VIBEX_STREAM_MINTER
  return hook && typeof hook.mintStream === 'function' ? hook : null
}

// --- reading what the page offered ----------------------------------------

/** The itag a googlevideo URL carries, or -1. */
export function itagOf(url) {
  const m = /[?&]itag=(\d+)/.exec(String(url || ''))
  return m ? Number(m[1]) : -1
}

/**
 * Pick an audio-only format out of a player response.
 *
 * `mimeType.startsWith('audio/')` is the whole point: a muxed `video/mp4`
 * would play sound, and also stream 3–5× the bytes, into a player built for
 * audio. A track with no audio-only rendition is refused, not downgraded.
 */
export function pickAudioFormat(formats) {
  const list = Array.isArray(formats) ? formats : []
  const audio = list.filter(
    (f) => f && typeof f.mimeType === 'string' && f.mimeType.startsWith('audio/') && f.url
  )
  if (!audio.length) return null
  for (const itag of AUDIO_ITAGS) {
    const hit = audio.find((f) => Number(f.itag) === itag)
    if (hit) return formatOf(hit)
  }
  // Unknown new itags still beat refusing: best bitrate, still audio-only.
  audio.sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0))
  return formatOf(audio[0])
}

function formatOf(f) {
  return {
    url: String(f.url),
    itag: Number(f.itag) || -1,
    mime: f.mimeType,
    bitrate: Number(f.bitrate) || 0,
    clen: Number(f.contentLength) || 0,
  }
}

/** Params the page's loader owns. Left in place they pin one byte window. */
const RANGE_PARAMS = ['range', 'rn', 'rbuf', 'rbum']

/**
 * Turn a captured URL into one we can drive ourselves.
 *
 * The signature params (`expire`, `ip`, `sig`, `n`, `pot`, `sparams`) are the
 * reason the URL works at all — they are copied through untouched, in order.
 * The duplicate-param case is real: the page sometimes appends `range=` twice,
 * and the second copy would survive a naive rewrite.
 */
export function normalizeCapturedUrl(raw) {
  const text = String(raw || '')
  if (!/^https?:\/\//.test(text)) return null
  const hashAt = text.indexOf('#')
  const base = hashAt === -1 ? text : text.slice(0, hashAt)
  const qAt = base.indexOf('?')
  if (qAt === -1) return null

  const seen = new Set()
  const kept = []
  for (const pair of base.slice(qAt + 1).split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const key = (eq === -1 ? pair : pair.slice(0, eq)).toLowerCase()
    if (RANGE_PARAMS.includes(key)) continue
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(pair)
  }
  if (!kept.length) return null

  const url = `${base.slice(0, qAt)}?${kept.join('&')}`
  return {
    url,
    itag: itagOf(url),
    clen: Number(paramOf(url, 'clen')) || 0,
    expireAt: expireAtOf(url),
  }
}

function paramOf(url, key) {
  const m = new RegExp(`[?&]${key}=(\\d+)`).exec(url)
  return m ? m[1] : null
}

function expireAtOf(url) {
  const m = /[?&]expire=(\d+)/.exec(url)
  return m ? Number(m[1]) * 1000 : null
}

/** `bytes 0-0/4812310` → 4812310. A `*` total means the server did not say. */
export function parseContentRange(header) {
  const m = /bytes\s+\d+-\d+\/(\d+)/i.exec(String(header || ''))
  return m ? Number(m[1]) : null
}

/**
 * The validity gate: never hand the player a URL this has not passed.
 *
 * Two probes, supplied by the native side because it is the only layer that can
 * reach googlevideo without CORS:
 *
 *   head — `Range: bytes=0-0`, whose `Content-Range` states what the server
 *          will actually serve for this signature;
 *   tail — the last kilobyte, which is where a preview URL 403s.
 *
 * Both are needed. The head probe alone catches a *shorter* file; the tail
 * probe is what proves the whole file is served rather than the prefix. A URL
 * that fails for a content reason (preview, short file) is terminal — re-minting
 * returns the same shape. A URL that is simply dead (403/403-on-tail) gets one
 * re-mint, because that is usually latency, not policy.
 */
export function validateProbe({
  headStatus,
  contentRange,
  tailStatus,
  declaredClen = 0,
  bitrate = 0,
  durationMs = 0,
} = {}) {
  const head = Number(headStatus)
  const tail = Number(tailStatus)

  if (head === 403 || head === 410) return { ok: false, reason: STREAM_STATE.expired }
  if (head !== 206) return { ok: false, reason: STREAM_STATE.notRanged }

  const served = parseContentRange(contentRange)
  if (!served || served <= 0) return { ok: false, reason: STREAM_STATE.notRanged }

  // The declared length is the baseline. A file materially shorter than what
  // the player response promised is the preview, caught before it plays.
  if (declaredClen > 0 && served < declaredClen * FULL_FILE_RATIO) {
    return { ok: false, reason: STREAM_STATE.previewTruncated, served, declared: declaredClen }
  }

  // Belt and braces: a consistently short file with no declared length still
  // looks wrong beside its own bitrate and duration.
  if (bitrate > 0 && durationMs > 0) {
    const expected = (bitrate / 8) * (durationMs / 1000)
    if (served < expected * DURATION_RATIO) {
      return { ok: false, reason: STREAM_STATE.shortFile, served, expected: Math.round(expected) }
    }
  }

  if (tail === 403 || tail === 410) return { ok: false, reason: STREAM_STATE.previewTruncated }
  if (tail !== 206) return { ok: false, reason: STREAM_STATE.tailUnreachable }

  return { ok: true, reason: null, served }
}

/** How long this URL may be reused. `min(expire − 5 min, 4 h)`. */
export function streamTtl(url, now = Date.now()) {
  const at = expireAtOf(String(url || ''))
  if (!at) return MAX_TTL_MS
  const ttl = at - EXPIRY_MARGIN_MS - now
  return Math.max(0, Math.min(ttl, MAX_TTL_MS))
}

// --- reading the bridge ----------------------------------------------------

/**
 * Normalise the plugin's answer.
 *
 * Tolerant on purpose: this is a hand-written native boundary, so a missing
 * field, a string where an object was expected, or a thrown platform error must
 * all become a typed reason rather than an exception in a click handler.
 */
export function readStreamMint(native) {
  if (!native || typeof native !== 'object') return failure(STREAM_STATE.failed, 'bad_result')
  // A challenge is decisive whatever `ok` says: the page can load and still be
  // a sign-in wall.
  if (native.blocked === true) return failure(STREAM_STATE.blocked, native.blockReason || 'blocked')
  if (native.ok !== true) {
    const why = String(native.why || native.error || 'unknown')
    // "Sign in to confirm you're not a bot" is the challenge YouTube serves,
    // so the space in "sign in" matters.
    if (/bot|sign\s*in|consent|challenge|login/i.test(why)) {
      return failure(STREAM_STATE.blocked, why)
    }
    if (why === 'no_direct_audio') return failure(STREAM_STATE.noDirectAudio, why)
    if (why === 'no_hits') return failure(STREAM_STATE.noHits, why)
    return failure(STREAM_STATE.failed, why)
  }
  if (typeof native.url !== 'string' || !native.url) {
    return failure(STREAM_STATE.failed, 'no_url')
  }
  const normalized = normalizeCapturedUrl(native.url)
  if (!normalized) return failure(STREAM_STATE.failed, 'bad_url')

  return {
    ok: true,
    url: normalized.url,
    itag: Number(native.itag) || normalized.itag,
    mime: String(native.mime || ''),
    clen: Number(native.clen) || normalized.clen,
    durationMs: Number(native.durationMs) || 0,
    bitrate: Number(native.bitrate) || 0,
    // The bridge flattens the probe onto the payload, because Capacitor's
    // JSObject only has typed `put()` overloads; accept a nested one too.
    probe:
      native.probe && typeof native.probe === 'object'
        ? native.probe
        : native.headStatus != null
          ? {
              headStatus: native.headStatus,
              contentRange: native.contentRange,
              tailStatus: native.tailStatus,
            }
          : null,
  }
}

// --- the mint itself -------------------------------------------------------

/** Reasons that will not change by asking again. Retrying them is how an IP gets flagged. */
const TERMINAL = new Set([
  STREAM_STATE.blocked,
  STREAM_STATE.noDirectAudio,
  STREAM_STATE.noHits,
  STREAM_STATE.previewTruncated,
  STREAM_STATE.notRanged,
  STREAM_STATE.tailUnreachable,
  STREAM_STATE.shortFile,
])

const CACHE = new Map()

/** Drop one minted URL. */
export function forgetStream(videoId) {
  CACHE.delete(String(videoId))
}

/**
 * Drop every minted URL.
 *
 * Called on a network change: `ip=` is part of the signature, so a URL minted
 * on Wi-Fi is a 403 on cellular even though it has not expired.
 */
export function invalidateStreams() {
  CACHE.clear()
}

/** Cache contents, for tests and for the network listener. */
export function cachedStreams() {
  return new Map(CACHE)
}

/**
 * Mint a playable URL for one video id.
 *
 * One attempt, then at most one re-mint, and only for a URL that came back
 * dead. Never a loop: repeat mints are the one failure this approach cannot
 * recover from, because they are what gets a listener's address flagged.
 */
export async function mintYtStream({ videoId, bridge, now = Date.now(), force = false } = {}) {
  if (!bridge) return failure(STREAM_STATE.noBridge)
  const id = String(videoId || '')
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return failure(STREAM_STATE.failed, 'no_video_id')

  if (!force) {
    const hit = CACHE.get(id)
    if (hit && hit.expiresAt > now) {
      return { ok: true, url: hit.url, itag: hit.itag, reason: null, state: STREAM_STATE.cached }
    }
    if (hit) CACHE.delete(id)
  }

  let last = failure(STREAM_STATE.failed, 'not_attempted')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let native
    try {
      native = await bridge.mintStream({ videoId: id })
    } catch (e) {
      last = failure(STREAM_STATE.failed, String(e?.message || e).slice(0, 120))
      continue
    }

    const minted = readStreamMint(native)
    if (!minted.ok) {
      last = minted
      if (TERMINAL.has(minted.reason)) return minted
      continue
    }

    // No probe numbers means the native side could not check the URL. That is
    // a failure, not a pass: an unverified URL is exactly the preview bug.
    if (!minted.probe) {
      last = failure(STREAM_STATE.failed, 'no_probe')
      continue
    }

    const verdict = validateProbe({
      headStatus: minted.probe.headStatus,
      contentRange: minted.probe.contentRange,
      tailStatus: minted.probe.tailStatus,
      declaredClen: minted.clen,
      bitrate: minted.bitrate,
      durationMs: minted.durationMs,
    })
    if (!verdict.ok) {
      last = failure(verdict.reason, verdict)
      if (TERMINAL.has(verdict.reason)) return last
      continue
    }

    const ttl = streamTtl(minted.url, now)
    if (ttl > 0) {
      CACHE.set(id, { url: minted.url, itag: minted.itag, expiresAt: now + ttl })
    }
    return {
      ok: true,
      url: minted.url,
      itag: minted.itag,
      mime: minted.mime,
      expiresAt: ttl > 0 ? now + ttl : null,
      reason: null,
      state: STREAM_STATE.ready,
    }
  }
  return last
}

/** The sentence for a failure, or '' when there is nothing to explain. */
export function streamFailureCopy(reason) {
  return STREAM_COPY[reason] || ''
}
