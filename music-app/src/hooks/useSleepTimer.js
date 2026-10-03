import { useCallback, useEffect, useRef, useState } from 'react'

/** Sleep timer. Returns minutes selected and ms remaining. */
export function useSleepTimer(onFire) {
  const [minutes, setMinutes] = useState(0)
  const [left, setLeft] = useState(0)
  const endAt = useRef(0)
  const fire = useRef(onFire)
  fire.current = onFire

  useEffect(() => {
    if (!minutes) {
      setLeft(0)
      return undefined
    }
    endAt.current = Date.now() + minutes * 60000
    setLeft(minutes * 60000)
    const t = setInterval(() => {
      const remaining = endAt.current - Date.now()
      if (remaining <= 0) {
        clearInterval(t)
        setMinutes(0)
        setLeft(0)
        fire.current?.()
        return
      }
      setLeft(remaining)
    }, 1000)
    return () => clearInterval(t)
  }, [minutes])

  return { minutes, left, setMinutes: useCallback((m) => setMinutes(m), []) }
}
