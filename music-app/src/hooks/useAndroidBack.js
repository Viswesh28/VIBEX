import { useEffect, useRef } from 'react'
import { onBackButton } from '../lib/native.js'

/**
 * Maps Android's hardware/gesture back to the app's own navigation stack.
 *
 * Order matters and mirrors what's visually on top: dismiss the drawer, then
 * the modal, then the lyrics overlay, then the full player, then pop a view. Only when nothing
 * is left do we report "not consumed" so the app minimises instead of exiting
 * — backgrounding keeps audio alive, closing would kill it mid-song.
 *
 * The handler is held in a ref because the Capacitor listener is registered
 * once; re-registering on every state change would race with in-flight presses.
 */
export function useAndroidBack({ drawer, plModal, lyricsOpen, fullOpen, canGoBack, actions }) {
  const stateRef = useRef({})
  stateRef.current = { drawer, plModal, lyricsOpen, fullOpen, canGoBack, actions }

  useEffect(() => {
    let dispose = () => {}
    let cancelled = false

    onBackButton(() => {
      const s = stateRef.current
      if (s.drawer) {
        s.actions.closeDrawer()
        return true
      }
      if (s.plModal) {
        s.actions.closePlaylistModal()
        return true
      }
      if (s.lyricsOpen) {
        s.actions.setLyricsOpen(false)
        return true
      }
      if (s.fullOpen) {
        s.actions.setFullOpen(false)
        return true
      }
      if (s.canGoBack) {
        s.actions.back()
        return true
      }
      return false
    }).then((off) => {
      if (cancelled) off()
      else dispose = off
    })

    return () => {
      cancelled = true
      dispose()
    }
  }, [])
}
