import { useEffect, useRef, useState } from 'react'
import {
  CANVAS_HEALTH,
  CANVAS_REASON,
  canvasDecision,
  canvasHealthGate,
  canvasQuery,
  readCanvasHealth,
  readCanvasResponse,
} from '../lib/canvas.js'
import { canvasMintBridge, mintCanvas, mintReason } from '../lib/canvasMint.js'

/**
 * Looks up the canvas clip for the current track.
 *
 * The lookup costs a request to a second provider, so it is gated on the
 * full-screen player being open (see canvasDecision) and the answer is cached
 * per song — opening and closing the player must not re-ask YouTube.
 *
 * Results are cached in memory *and* sessionStorage: the first survives a
 * re-render, the second survives a reload within the same tab without
 * hammering an undocumented endpoint.
 *
 * Two transports, and the device decides which one it gets:
 *
 * * **native shell** — the track's page is opened offscreen on this device and
 *   asked what it already resolved (`canvasMint.js`). A real page is not gated
 *   the way a serverless client is, so this is the path that can actually
 *   produce a canvas.
 * * **web** — the server route, gated behind a health probe: YouTube will not
 *   describe a music track to this deployment, so asking per track would only
 *   spend a request to learn the same answer each time.
 *
 * Either way a miss degrades to artwork, and nothing is fetched while the
 * player is closed or Data Saver is on.
 */

const MEM = new Map()
const STORE_KEY = 'svCanvasCache'
const MAX_ENTRIES = 40
const HEALTH_KEY = 'svCanvasHealth'
/** Re-check the deployment now and then, so an unblock turns the feature back on. */
const HEALTH_TTL = 30 * 60 * 1000

let healthInFlight = null

function readStore() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(id, entry) {
  try {
    const all = readStore()
    all[id] = entry
    const keys = Object.keys(all)
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete all[k]
    sessionStorage.setItem(STORE_KEY, JSON.stringify(all))
  } catch {
    /* private mode or a full quota — the in-memory cache still works */
  }
}

function readHealth() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(HEALTH_KEY) || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    if (!Number.isFinite(parsed.at) || Date.now() - parsed.at > HEALTH_TTL) return null
    return parsed.state || null
  } catch {
    return null
  }
}

function writeHealth(state) {
  try {
    sessionStorage.setItem(HEALTH_KEY, JSON.stringify({ state, at: Date.now() }))
  } catch {
    /* not worth failing a cosmetic feature over */
  }
}

/**
 * The shared "may we ask?" answer, at most once per TTL per tab.
 *
 * Concurrent players (the full player re-mounting, say) share one request
 * rather than each starting their own probe.
 */
function loadHealth() {
  const stored = readHealth()
  if (stored) return Promise.resolve(stored)
  if (healthInFlight) return healthInFlight

  healthInFlight = fetch('/api/canvas?health=1')
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => {
      const { state } = readCanvasHealth(body)
      writeHealth(state)
      return state
    })
    .catch(() => CANVAS_HEALTH.unknown)
    .finally(() => {
      healthInFlight = null
    })

  return healthInFlight
}

export function useCanvasVideo({ track, open, dataSaver, enabled }) {
  const decision = canvasDecision({
    open,
    dataSaver,
    enabled,
    hasTrack: !!track?.id,
  })
  const [state, setState] = useState({ url: null, reason: decision.reason, loading: false })
  const abortRef = useRef(null)

  const id = track?.id || null

  useEffect(() => {
    if (!decision.ask || !id) {
      setState({ url: null, reason: decision.reason, loading: false })
      return undefined
    }

    const cached = MEM.get(id) || readStore()[id]
    if (cached) {
      MEM.set(id, cached)
      setState({ url: cached.videoUrl || null, reason: cached.reason, loading: false })
      return undefined
    }

    const query = canvasQuery(track)
    if (!query) {
      setState({ url: null, reason: CANVAS_REASON.notFound, loading: false })
      return undefined
    }

    const ctrl = new AbortController()
    abortRef.current = ctrl
    let cancelled = false
    setState({ url: null, reason: CANVAS_REASON.ready, loading: true })

    // Native shell: mint from the device's own page instead of asking a server
    // that YouTube refuses. The health probe is about the server, so it does
    // not apply here and is skipped.
    const bridge = canvasMintBridge()
    if (bridge) {
      mintCanvas({ query, bridge })
        .then((result) => {
          if (cancelled) return
          const reason = result.url ? CANVAS_REASON.ready : mintReason(result.state)
          const entry = { videoUrl: result.url, reason }
          MEM.set(id, entry)
          if (result.url) writeStore(id, entry)
          setState({ url: result.url, reason, loading: false })
        })
        .catch((e) => {
          if (cancelled) return
          setState({ url: null, reason: CANVAS_REASON.failed, loading: false })
          void e
        })
      return () => {
        cancelled = true
      }
    }

    const params = new URLSearchParams({
      title: String(track.name || ''),
      artist: String(track.artist || '').split(',')[0].trim(),
    })

    loadHealth()
      .then((health) => {
        if (cancelled) return null
        const gate = canvasHealthGate(health)
        if (!gate.ask) {
          setState({ url: null, reason: gate.reason, loading: false })
          return null
        }
        return fetch(`/api/canvas?${params.toString()}`, { signal: ctrl.signal })
          .then((r) => (r.ok ? r.json() : { success: false, code: 'upstream_error' }))
          .then((body) => {
            if (cancelled) return
            const result = readCanvasResponse(body)
            // A challenge is worth remembering: the next track would only learn it again.
            if (result.reason === CANVAS_REASON.deploymentBlocked) {
              writeHealth(CANVAS_HEALTH.blocked)
            }
            const entry = { videoUrl: result.url, reason: result.reason }
            MEM.set(id, entry)
            // Only cache a positive hit: a miss may be a transient block, and
            // pinning "no canvas" for a session would hide clips that resolve later.
            if (result.url) writeStore(id, entry)
            setState({ url: result.url, reason: result.reason, loading: false })
          })
      })
      .catch((e) => {
        if (cancelled || e?.name === 'AbortError') return
        setState({ url: null, reason: CANVAS_REASON.failed, loading: false })
      })

    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [decision.ask, decision.reason, id, track, open, dataSaver, enabled])

  return { ...state, decision }
}
