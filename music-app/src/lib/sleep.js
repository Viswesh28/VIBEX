// ==========================================================================
// Sleep timer — the fade maths, kept out of the hook.
// --------------------------------------------------------------------------
// A timer that hard-pauses mid-verse wakes people up. The last stretch ramps
// down on the same equal-power curve the crossfade uses, so the drop is
// perceptually even rather than the last second falling off a cliff.
// ==========================================================================

/** Ramp length. Long enough to be unnoticed, short enough to beat the click. */
export const SLEEP_FADE_SEC = 20

export const clamp01 = (n) => {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * Playback gain for a sleep timer.
 *
 * @param elapsedSec seconds since the timer started
 * @param totalSec   timer length in seconds (0 = no timer)
 * @param fadeSec    length of the closing ramp
 *
 * Returns 1 while there is more than `fadeSec` left, then rides an
 * equal-power cosine down to exactly 0 at the end. Never rises.
 */
export function sleepGain(elapsedSec, totalSec, fadeSec = SLEEP_FADE_SEC) {
  const total = Number(totalSec)
  if (!Number.isFinite(total) || total <= 0) return 1
  const elapsed = clamp01(Number(elapsedSec) / total) * total
  // Land on exact silence; cos(π/2) is 6e-17, not 0.
  if (elapsed >= total) return 0
  const fade = Math.max(0, Math.min(Number(fadeSec) || 0, total))
  const fadeStart = total - fade
  if (elapsed <= fadeStart) return 1
  if (fade <= 0) return 0
  const e = clamp01((elapsed - fadeStart) / fade)
  return Math.cos((e * Math.PI) / 2)
}

/** True once the timer has fully elapsed. */
export function sleepExpired(elapsedSec, totalSec) {
  const total = Number(totalSec)
  if (!Number.isFinite(total) || total <= 0) return false
  return Number(elapsedSec) >= total
}

/**
 * Human label for the timer state. `leftMs` is what the UI already tracks.
 * The fade window is called out explicitly so "why is it quiet?" has an answer.
 */
export function describeSleep(leftMs, totalSec, fadeSec = SLEEP_FADE_SEC) {
  const left = Math.max(0, Number(leftMs) || 0) / 1000
  if (!(Number(totalSec) > 0)) return 'Playback continues.'
  if (left <= 0) return 'Stopping now.'
  if (left <= fadeSec) return `Fading out — ${Math.ceil(left)}s left.`
  const mins = Math.floor(left / 60)
  const secs = Math.round(left % 60)
  return `Stops in ${mins ? `${mins}m ` : ''}${secs}s (fades over the last ${Math.round(fadeSec)}s).`
}
