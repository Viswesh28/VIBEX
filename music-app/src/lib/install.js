/**
 * Install plumbing.
 *
 * Chrome/Edge/Android expose `beforeinstallprompt`, which can be replayed from
 * a button later. Safari never does; on iOS the only path is Share → Add to
 * Home Screen, so the UI has to explain it instead of pretending to offer a
 * one-tap install.
 */

let deferredPrompt = null
let installed = false
const listeners = new Set()

const emit = () => {
  for (const fn of listeners) {
    try {
      fn(availability())
    } catch {
      /* a broken listener must not break the others */
    }
  }
}

export function initInstallPrompt(win = typeof window !== 'undefined' ? window : null) {
  if (!win || win.__VIBEX_INSTALL_BOUND__) return
  win.__VIBEX_INSTALL_BOUND__ = true
  win.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event
    emit()
  })
  win.addEventListener('appinstalled', () => {
    deferredPrompt = null
    installed = true
    emit()
  })
}

export function availability() {
  return { canPrompt: !!deferredPrompt, installed }
}

export function subscribeInstall(fn) {
  listeners.add(fn)
  fn(availability())
  return () => listeners.delete(fn)
}

/** Returns 'accepted' | 'dismissed' | 'unavailable'. */
export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable'
  const event = deferredPrompt
  deferredPrompt = null
  try {
    event.prompt()
    const choice = await event.userChoice
    emit()
    return choice?.outcome || 'dismissed'
  } catch {
    emit()
    return 'unavailable'
  }
}
