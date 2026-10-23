import { useEffect } from 'react'

/**
 * Global shortcuts. One listener for the whole app — including Ctrl+K / Cmd+K
 * for the Spotlight command palette anywhere in VIBEX.
 */
export function useKeyboardShortcuts({
  onToggle,
  onNext,
  onPrev,
  onSeek,
  onEscape,
  onCommandPalette,
}) {
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        onCommandPalette?.()
        return
      }
      if (e.key === 'Escape') {
        onEscape?.()
        return
      }
      const tag = e.target?.tagName
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
  }, [onToggle, onNext, onPrev, onSeek, onEscape, onCommandPalette])
}
