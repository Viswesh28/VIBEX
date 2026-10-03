import { useEffect } from 'react'

/**
 * Global shortcuts. One listener for the whole app — the pre-React build had
 * four competing keydown handlers, which made Escape order hard to reason about.
 */
export function useKeyboardShortcuts({ onToggle, onNext, onPrev, onSeek, onEscape }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        onEscape?.()
        return
      }
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.code === 'Space') {
        e.preventDefault()
        onToggle?.()
      } else if (e.key === 'n' || e.key === 'N') onNext?.()
      else if (e.key === 'p' || e.key === 'P') onPrev?.()
      else if (e.key === 'ArrowRight') onSeek?.(10)
      else if (e.key === 'ArrowLeft') onSeek?.(-10)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onToggle, onNext, onPrev, onSeek, onEscape])
}
