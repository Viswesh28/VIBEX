/**
 * Minting a canvas on the device, from a real page.
 *
 * The server-side lookup in `api/canvas.mjs` cannot work: YouTube will not
 * describe a music track to a client without a signed-in session, and a
 * serverless function has none. See `docs/adr/0001-canvas-deployment-blocked.md`.
 *
 * A page in a WebView is different in exactly the way that matters: it is a
 * real YouTube client, on the listener's own connection, running YouTube's own
 * script. Whatever the page knows about a track — including the canvas it
 * renders — is available to it, and a WebView lets us read it back.
 *
 * So the WebView is treated as a **mint**: load the track once, read what the
 * page already resolved, hand the URL to the existing `<video>` layer, and
 * throw the page away. It never plays audio here.
 *
 * Nothing in this module touches a WebView directly. The native side is behind
 * `CanvasMintBridge`, so every decision below is testable in Node — which is
 * the only way this can be tested at all, since the sandbox has no Android SDK.
 */

import { CANVAS_REASON, pickCanvasUrl } from './canvas.js'

/** How a mint attempt may end. Separate from the server-side reasons. */
export const MINT_STATE = {
  ready: 'ready',
  noBridge: 'no_bridge',
  blocked: 'blocked',
  noCanvas: 'no_canvas',
  failed: 'failed',
}

/** Longest player response worth sending across the bridge (~4 MB of JSON). */
export const MAX_RESPONSE_CHARS = 4_000_000

/** A URL is only trusted for as long as its own `expire` says, minus a margin. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000
const DEFAULT_TTL_MS = 60 * 60 * 1000

/**
 * The native plugin, if this build has one.
 *
 * Deliberately narrow: Android only (iOS blocks offscreen media and would fail
 * invisibly), native shell only (a browser tab has no plugin), and the plugin
 * has to actually be registered — `Capacitor.Plugins.X` exists as a proxy on
 * web even when nothing is behind it, so presence alone is not proof.
 */
export function canvasMintBridge(win) {
  const w = win || (typeof window !== 'undefined' ? window : null)
  if (!w?.Capacitor?.isNativePlatform?.()) return null
  if (w.Capacitor.getPlatform?.() !== 'android') return null
  const plugin = w.Capacitor.Plugins?.CanvasMint
  return plugin && typeof plugin.mint === 'function' ? plugin : null
}

/** Which transport should serve a canvas for this build? */
export function canvasTransport(bridge) {
  return bridge ? 'mint' : 'server'
}

/**
 * Normalise whatever the plugin returned.
 *
 * Tolerant on purpose: the bridge is a hand-written native boundary, so a
 * missing field, a string where an object was expected, or a thrown platform
 * error must all become "artwork", never an exception in a render.
 */
export function readMintResult(native) {
  if (!native || typeof native !== 'object') {
    return { ok: false, state: MINT_STATE.failed, reason: 'bad_result' }
  }
  // A gate is decisive whatever `ok` says: the page may have loaded fine and
  // still been a sign-in wall, and the plugin reports both flags.
  if (native.blocked === true) {
    return { ok: false, state: MINT_STATE.blocked, reason: String(native.blockReason || 'blocked') }
  }
  if (native.ok !== true) {
    const why = String(native.why || native.error || 'unknown')
    const blocked = /bot|signin|sign_in|consent|challenge|login/i.test(why)
    return {
      ok: false,
      state: blocked ? MINT_STATE.blocked : MINT_STATE.failed,
      reason: why,
    }
  }
  const response = native.response
  if (typeof response === 'string' && response.length > MAX_RESPONSE_CHARS) {
    return { ok: false, state: MINT_STATE.failed, reason: 'response_too_large' }
  }
  if (!response) return { ok: false, state: MINT_STATE.failed, reason: 'no_response' }
  return { ok: true, state: MINT_STATE.ready, response }
}

/**
 * Pick a canvas out of a minted player response.
 *
 * The ranking is `pickCanvasUrl`'s — the same walker the server path uses, so
 * there is one definition of "looks like a canvas" in the codebase. The extra
 * rule here is that the winning candidate must actually sit under a canvas key:
 * a music video's `video/mp4` formats are *not* a canvas, and showing the
 * official video where a loop belongs would be the fake this project refuses.
 */
export function pickMintedCanvas(payload) {
  let parsed = payload
  if (typeof payload === 'string') {
    try {
      parsed = JSON.parse(payload)
    } catch {
      return { url: null, state: MINT_STATE.failed, reason: 'unparseable_response' }
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { url: null, state: MINT_STATE.failed, reason: 'unparseable_response' }
  }

  if (parsed.playabilityStatus) {
    const status = String(parsed.playabilityStatus.status || '')
    if (/LOGIN_REQUIRED|AGE_CHECK_REQUIRED|ERROR/i.test(status)) {
      return {
        url: null,
        state: MINT_STATE.blocked,
        reason: parsed.playabilityStatus.reason || status,
      }
    }
  }

  const hit = pickCanvasUrl(parsed)
  if (!hit) return { url: null, state: MINT_STATE.noCanvas, reason: 'no_candidate' }
  if (!/canvas/i.test(hit.path)) {
    // A media URL exists, but nothing identifies it as a canvas. Refuse it.
    return { url: null, state: MINT_STATE.noCanvas, reason: 'not_a_canvas' }
  }
  return { url: hit.url, path: hit.path, state: MINT_STATE.ready, reason: null }
}

/** How long a minted URL is good for, from its own `expire` parameter. */
export function mintTtl(url, now = Date.now()) {
  const m = /[?&]expire=(\d+)/.exec(String(url || ''))
  if (!m) return DEFAULT_TTL_MS
  const ttl = Number(m[1]) * 1000 - now - EXPIRY_MARGIN_MS
  return Number.isFinite(ttl) && ttl > 0 ? ttl : 0
}

const CACHE = new Map()

/** Drop a cached mint. Used by tests and by an explicit retry. */
export function forgetMint(videoId) {
  CACHE.delete(videoId)
}

/**
 * Mint one canvas, with a cache that respects the URL's own expiry.
 *
 * `bridge` is injected rather than reached for, so a test can drive a fake
 * WebView. `now` exists for the same reason: expiry is time-dependent.
 */
export async function mintCanvas({ videoId, query, bridge, now = Date.now() } = {}) {
  if (!bridge) return { url: null, state: MINT_STATE.noBridge, reason: 'no_bridge' }
  if (!videoId && !query) return { url: null, state: MINT_STATE.noCanvas, reason: 'no_query' }

  const key = String(videoId || query)
  const cached = CACHE.get(key)
  if (cached && cached.expiresAt > now) {
    return { url: cached.url, state: MINT_STATE.ready, reason: null, cached: true }
  }

  let native
  try {
    native = await bridge.mint({
      videoId: videoId || undefined,
      query: videoId ? undefined : query,
    })
  } catch (e) {
    return { url: null, state: MINT_STATE.failed, reason: String(e?.message || e).slice(0, 120) }
  }

  const result = readMintResult(native)
  if (!result.ok) {
    return { url: null, state: result.state, reason: result.reason }
  }

  const picked = pickMintedCanvas(result.response)
  if (!picked.url) return { url: null, state: picked.state, reason: picked.reason }

  const ttl = mintTtl(picked.url, now)
  if (ttl > 0) CACHE.set(key, { url: picked.url, expiresAt: now + ttl })
  return { url: picked.url, state: MINT_STATE.ready, reason: null, path: picked.path }
}

/** The reason code the UI explains, from a mint state. */
export function mintReason(state) {
  if (state === MINT_STATE.blocked) return CANVAS_REASON.mintBlocked
  if (state === MINT_STATE.noCanvas) return CANVAS_REASON.noCanvasOnPage
  return CANVAS_REASON.failed
}
