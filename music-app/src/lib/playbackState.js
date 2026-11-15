// ==========================================================================
// Playback state machine & failure classification.
// --------------------------------------------------------------------------
// Explicit lifecycle:
//   Idle → Resolving → Ready → Buffering → Playing ↔ Paused → Ended
//                                                          ↘ Failed
//
// Failure categories map transport, entitlement, region, format, and auth
// errors onto honest, user-actionable states rather than generic "error,
// skipping" loops or silent track substitutions.
// ==========================================================================

import { FAILURE, classifyMediaError, isExpired } from './stream.js'

export const PLAYBACK_STATE = {
  Idle: 'Idle',
  Resolving: 'Resolving',
  Ready: 'Ready',
  Buffering: 'Buffering',
  Playing: 'Playing',
  Paused: 'Paused',
  Ended: 'Ended',
  Failed: 'Failed',
}

export const PLAYBACK_FAILURE = {
  NetworkRetryable: 'NetworkRetryable',
  ExpiredPlaybackReference: 'ExpiredPlaybackReference',
  AuthorizationRequired: 'AuthorizationRequired',
  NotAvailableInRegion: 'NotAvailableInRegion',
  RightsOrDrm: 'Rights/DRM',
  UnsupportedFormat: 'UnsupportedFormat',
  ProviderUnavailable: 'ProviderUnavailable',
}

export const PLAYBACK_FAILURE_COPY = {
  [PLAYBACK_FAILURE.NetworkRetryable]:
    'Network connection dropped while loading this track. Check your connection and retry.',
  [PLAYBACK_FAILURE.ExpiredPlaybackReference]:
    'The temporary playback link expired and could not be refreshed. Press play to resolve again.',
  [PLAYBACK_FAILURE.AuthorizationRequired]:
    'Sign-in is required by this provider before playback is allowed — choose an authorized source or sign in.',
  [PLAYBACK_FAILURE.NotAvailableInRegion]:
    'This track is not available in your region due to provider territory restrictions.',
  [PLAYBACK_FAILURE.RightsOrDrm]:
    'Playback is restricted by the rights holder or requires DRM licensing not granted to this player.',
  [PLAYBACK_FAILURE.UnsupportedFormat]:
    'This device or browser cannot decode the audio format provided for this track.',
  [PLAYBACK_FAILURE.ProviderUnavailable]:
    'The music provider is temporarily unavailable or rate-limiting requests. Try again shortly.',
}

export const MAX_NETWORK_RETRIES = 2
export const MAX_EXPIRED_RERESOLVES = 1

/** Human-readable, honest explanation for any failure category. */
export function playbackFailureCopy(category) {
  return PLAYBACK_FAILURE_COPY[category] || PLAYBACK_FAILURE_COPY[PLAYBACK_FAILURE.ProviderUnavailable]
}

/** Bounded exponential backoff with jitter (`base * 2^attempt + jitter`). */
export function computeBackoffMs(attempt = 0, { baseMs = 500, maxMs = 6000, random = Math.random } = {}) {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempt)))
  const jitter = Math.round(exp * 0.25 * Math.max(0, Math.min(1, random())))
  return Math.min(maxMs, exp + jitter)
}

/**
 * Classify a transport, resolver, HTTP, or embed error into one of the seven
 * canonical failure categories. Never masks authorization, geo, or DRM blocks
 * as transient network errors.
 */
export function classifyPlaybackFailure(input, { url = '', nowMs = Date.now() } = {}) {
  if (!input) return PLAYBACK_FAILURE.ProviderUnavailable

  if (typeof input === 'string' && Object.values(PLAYBACK_FAILURE).includes(input)) {
    return input
  }
  if (input?.category && Object.values(PLAYBACK_FAILURE).includes(input.category)) {
    return input.category
  }

  // YouTube IFrame Player API error codes:
  //   101 / 150 = owner disallowed embedded playback (rights block)
  //   100       = removed or private
  //   5         = HTML5 player format/codec failure
  const embedCode = input?.embedCode != null ? Number(input.embedCode) : null
  if (embedCode === 101 || embedCode === 150 || embedCode === 100) {
    return PLAYBACK_FAILURE.RightsOrDrm
  }
  if (embedCode === 5) {
    return PLAYBACK_FAILURE.UnsupportedFormat
  }

  const status = Number(input?.status ?? input?.httpStatus ?? 0)
  const code = String(input?.code || '').toLowerCase()
  const message = String(input?.message || '').toLowerCase()

  if (status === 401 || code === 'login_required' || code === 'auth_required' || /login_required|sign in|unauthorized/.test(message)) {
    return PLAYBACK_FAILURE.AuthorizationRequired
  }
  if (status === 451 || code === 'not_available_in_region' || /region|country|territory|geo/.test(message)) {
    return PLAYBACK_FAILURE.NotAvailableInRegion
  }
  if (code === 'drm_required' || code === 'rights_restricted' || /drm|widevine|fairplay|license|embed.*disabled|rights/.test(message)) {
    return PLAYBACK_FAILURE.RightsOrDrm
  }
  if (status === 410 || code === 'expired' || code === 'stale_url' || (status === 403 && url && isExpired(url, nowMs))) {
    return PLAYBACK_FAILURE.ExpiredPlaybackReference
  }
  if (status === 403) {
    return PLAYBACK_FAILURE.RightsOrDrm
  }
  if (status === 429 || status >= 500 || code === 'provider_unavailable' || code === 'upstream_error' || code === 'blocked') {
    return PLAYBACK_FAILURE.ProviderUnavailable
  }
  if (code === 'timeout' || code === 'network' || /network|fetch|offline|timeout|econnreset/.test(message)) {
    return PLAYBACK_FAILURE.NetworkRetryable
  }

  // Browser HTMLMediaElement error event / MediaError object.
  const mediaReason = classifyMediaError(input)
  if (mediaReason === FAILURE.decode || mediaReason === FAILURE.unsupported) {
    return PLAYBACK_FAILURE.UnsupportedFormat
  }
  if (mediaReason === FAILURE.network || mediaReason === FAILURE.aborted) {
    if (url && isExpired(url, nowMs)) return PLAYBACK_FAILURE.ExpiredPlaybackReference
    return PLAYBACK_FAILURE.NetworkRetryable
  }
  if (url && isExpired(url, nowMs)) {
    return PLAYBACK_FAILURE.ExpiredPlaybackReference
  }

  return PLAYBACK_FAILURE.NetworkRetryable
}

/**
 * Decide the recovery step for a classified failure:
 * - `ExpiredPlaybackReference` → re-resolve strictly ONCE (`reResolvedCount < 1`)
 * - `NetworkRetryable`         → retry with bounded backoff (`networkAttempts < 2`)
 * - Every auth / region / DRM / format / provider error → surface honestly immediately
 */
export function decideFailureAction(
  category,
  { networkAttempts = 0, reResolvedCount = 0, random = Math.random } = {}
) {
  if (category === PLAYBACK_FAILURE.ExpiredPlaybackReference && reResolvedCount < MAX_EXPIRED_RERESOLVES) {
    return {
      action: 're_resolve',
      backoffMs: 0,
      category,
    }
  }
  if (category === PLAYBACK_FAILURE.NetworkRetryable && networkAttempts < MAX_NETWORK_RETRIES) {
    return {
      action: 'retry_network',
      backoffMs: computeBackoffMs(networkAttempts, { random }),
      category,
    }
  }
  return {
    action: 'surface_error',
    backoffMs: 0,
    category,
    message: playbackFailureCopy(category),
  }
}

export function initialPlaybackMachine() {
  return {
    state: PLAYBACK_STATE.Idle,
    trackKey: null,
    mode: null,
    failure: null,
    networkAttempts: 0,
    reResolvedCount: 0,
  }
}

/**
 * Pure playback state machine reducer:
 * `Idle → Resolving → Ready → Buffering → Playing ↔ Paused → Ended` (+ `Failed`).
 */
export function transitionPlaybackState(machine = initialPlaybackMachine(), event = {}) {
  switch (event.type) {
    case 'RESET':
      return initialPlaybackMachine()

    case 'RESOLVE_START': {
      const sameTrack = event.trackKey && event.trackKey === machine.trackKey && Boolean(event.isReResolve)
      return {
        state: PLAYBACK_STATE.Resolving,
        trackKey: event.trackKey || machine.trackKey || null,
        mode: event.mode || machine.mode || null,
        failure: null,
        networkAttempts: sameTrack ? machine.networkAttempts : 0,
        reResolvedCount: sameTrack ? machine.reResolvedCount + 1 : 0,
      }
    }

    case 'RESOLVE_READY':
      return {
        ...machine,
        state: PLAYBACK_STATE.Ready,
        mode: event.mode || machine.mode || 'stream',
        failure: null,
      }

    case 'BUFFERING':
      return {
        ...machine,
        state: PLAYBACK_STATE.Buffering,
        failure: null,
      }

    case 'PLAYING':
      return {
        ...machine,
        state: PLAYBACK_STATE.Playing,
        failure: null,
        networkAttempts: 0,
      }

    case 'PAUSED':
      if (machine.state === PLAYBACK_STATE.Idle || machine.state === PLAYBACK_STATE.Failed) {
        return machine
      }
      return {
        ...machine,
        state: PLAYBACK_STATE.Paused,
      }

    case 'ENDED':
      return {
        ...machine,
        state: PLAYBACK_STATE.Ended,
      }

    case 'NETWORK_RETRY':
      return {
        ...machine,
        state: PLAYBACK_STATE.Buffering,
        networkAttempts: machine.networkAttempts + 1,
      }

    case 'FAILED': {
      const category = event.category || PLAYBACK_FAILURE.ProviderUnavailable
      return {
        ...machine,
        state: PLAYBACK_STATE.Failed,
        failure: {
          category,
          message: event.message || playbackFailureCopy(category),
        },
      }
    }

    default:
      return machine
  }
}
