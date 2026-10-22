// ==========================================================================
// Telemetry — a local ring buffer, not a beacon.
// --------------------------------------------------------------------------
// The research this build follows makes one thing clear: silent degradation is
// invisible without an event. VIBEX ships no analytics, so the events are kept
// on the device where they are useful for debugging and for the in-app
// diagnostics panel: what degraded, what was recommended, what was dismissed.
// ==========================================================================

const MAX_EVENTS = 200
const buffer = []
const listeners = new Set()
let store = null

const now = () => Date.now()

/** Attach a persistence sink lazily so this module stays import-safe in tests. */
export function configureTelemetry({ persist } = {}) {
  store = typeof persist === 'function' ? persist : null
}

function emit(event, props) {
  const record = { event, at: now(), ...(props || {}) }
  buffer.push(record)
  if (buffer.length > MAX_EVENTS) buffer.splice(0, buffer.length - MAX_EVENTS)
  if (store) {
    try {
      store(buffer.slice(-MAX_EVENTS))
    } catch {
      /* diagnostics must never break playback */
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('vibex:telemetry', { detail: record }))
    } catch {
      /* no CustomEvent (very old WebView) */
    }
  }
  listeners.forEach((fn) => {
    try {
      fn(record)
    } catch {
      /* ignore a bad subscriber */
    }
  })
  return record
}

export const track = emit

export function recent(count = 20) {
  return buffer.slice(-Math.max(1, count))
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function clear() {
  buffer.length = 0
}

/** Small, explicit vocabulary — one place to see what the app reports. */
export const EVENTS = {
  homeDegraded: 'home.degraded',
  homeFailed: 'home.failed',
  homeLoaded: 'home.loaded',
  recImpression: 'recommend.impression',
  recDismissed: 'recommend.dismissed',
  recSkippedEarly: 'recommend.skipped_early',
  autoplayFailed: 'autoplay.failed',
  transitionPlanned: 'transition.planned',
  transitionFallback: 'transition.fallback',
  streamRecovered: 'stream.recovered',
  streamFailed: 'stream.failed',
}
