import { useEffect, useRef, useState } from 'react'
import {
  CANVAS_REASON,
  canvasDecision,
  canvasQuery,
  readCanvasResponse,
} from '../lib/canvas.js'

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
 */

const MEM = new Map()
const STORE_KEY = 'svCanvasCache'
const MAX_ENTRIES = 40

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

    const ctrl = new AbortController()
    abortRef.current = ctrl
    setState({ url: null, reason: CANVAS_REASON.ready, loading: true })

    const params = new URLSearchParams({
      title: String(track.name || ''),
      artist: String(track.artist || '').split(',')[0].trim(),
    })
    const query = canvasQuery(track)
    if (!query) {
      setState({ url: null, reason: CANVAS_REASON.notFound, loading: false })
      return undefined
    }

    fetch(`/api/canvas?${params.toString()}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { success: false, code: 'upstream_error' }))
      .then((body) => {
        const result = readCanvasResponse(body)
        const entry = { videoUrl: result.url, reason: result.reason }
        MEM.set(id, entry)
        // Only cache a positive hit: a miss may be a transient block, and
        // pinning "no canvas" for a session would hide clips that resolve later.
        if (result.url) writeStore(id, entry)
        setState({ url: result.url, reason: result.reason, loading: false })
      })
      .catch((e) => {
        if (e?.name === 'AbortError') return
        setState({ url: null, reason: CANVAS_REASON.failed, loading: false })
      })

    return () => ctrl.abort()
  }, [decision.ask, decision.reason, id, track, open, dataSaver, enabled])

  return { ...state, decision }
}
