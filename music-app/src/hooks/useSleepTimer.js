import { useCallback, useEffect, useRef, useState } from 'react'
import { SLEEP_FADE_SEC, sleepGain } from '../lib/sleep.js'

/**
 * Sleep timer.
 *
 * Playback does not stop dead at the end of the countdown: it ramps down over
 * the last SLEEP_FADE_SEC so a listener who is almost asleep is not jolted by
 * a hard cut (and so the abrupt silence does not read as a playback failure).
 *
 * `onFade(gain)` is called every tick with the multiplier to apply to the
 * current volume; `onDone()` fires once the ramp reaches zero. The gain is
 * always reset to 1 when the timer is cancelled or when the component unmounts,
 * otherwise cancelling a fade would leave the app silent.
 */
export function useSleepTimer(onDone, onFade) {
  const [minutes, setMinutes] = useState(0)
  const [left, setLeft] = useState(0)
  const endAt = useRef(0)
  const done = useRef(onDone)
  const fade = useRef(onFade)
  done.current = onDone
  fade.current = onFade

  useEffect(() => {
    if (!minutes) {
      setLeft(0)
      return undefined
    }
    const total = minutes * 60000
    endAt.current = Date.now() + total
    setLeft(total)
    fade.current?.(sleepGain(0, total))

    const tick = () => {
      const remaining = endAt.current - Date.now()
      if (remaining <= 0) {
        setMinutes(0)
        setLeft(0)
        // Hand the volume back before pausing: the next play must not inherit
        // the silence of the ramp.
        fade.current?.(1)
        done.current?.()
        return
      }
      setLeft(remaining)
      fade.current?.(sleepGain(total - remaining, total))
    }

    // 250ms is enough for a 20s cosine to sound continuous, and cheap enough
    // to run on a phone without waking the audio thread.
    const t = setInterval(tick, 250)
    return () => {
      clearInterval(t)
      fade.current?.(1)
    }
  }, [minutes])

  return {
    minutes,
    left,
    fading: minutes > 0 && left > 0 && left <= SLEEP_FADE_SEC * 1000,
    setMinutes: useCallback((m) => setMinutes(m), []),
  }
}
