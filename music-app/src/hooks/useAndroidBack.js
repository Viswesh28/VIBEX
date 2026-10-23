import { useEffect, useRef } from 'react'
import { onBackButton } from '../lib/native.js'

/**
 * Maps Android's hardware/gesture back to VIBEX's layered UI & navigation stack.
 *
 * Dismisses the topmost visible sheet/modal first:
 *   drawer -> command palette -> share modal -> DSP rack -> import modal
 *   -> playlist modal -> lyrics overlay -> full player -> view history back.
 * Only at the root view with nothing open do we return `false`, allowing
 * `native.js` to call `minimizeApp()` (`moveTaskToBack(true)`) so music continues
 * streaming uninterrupted in the background.
 */
export function useAndroidBack({
  drawer,
  cmdOpen,
  shareOpen,
  dspOpen,
  importModalOpen,
  plModal,
  lyricsOpen,
  fullOpen,
  canGoBack,
  actions,
}) {
  const stateRef = useRef({})
  stateRef.current = {
    drawer,
    cmdOpen,
    shareOpen,
    dspOpen,
    importModalOpen,
    plModal,
    lyricsOpen,
    fullOpen,
    canGoBack,
    actions,
  }

  useEffect(() => {
    let dispose = () => {}
    let cancelled = false

    onBackButton(() => {
      const s = stateRef.current
      if (s.drawer) {
        s.actions.closeDrawer?.()
        return true
      }
      if (s.cmdOpen) {
        s.actions.closeCmd?.()
        return true
      }
      if (s.shareOpen) {
        s.actions.closeShare?.()
        return true
      }
      if (s.dspOpen) {
        s.actions.closeDsp?.()
        return true
      }
      if (s.importModalOpen) {
        s.actions.closeImport?.()
        return true
      }
      if (s.plModal) {
        s.actions.closePlaylistModal?.()
        return true
      }
      if (s.lyricsOpen) {
        s.actions.setLyricsOpen?.(false)
        return true
      }
      if (s.fullOpen) {
        s.actions.setFullOpen?.(false)
        return true
      }
      const hasBack = typeof s.canGoBack === 'function' ? s.canGoBack() : Boolean(s.canGoBack)
      if (hasBack) {
        s.actions.back?.()
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
