import { isNativeShell } from './platform.js'

/**
 * Register the app-shell worker.
 *
 * Production web only: the Capacitor build runs from localhost inside a
 * WebView (where a service worker buys nothing and can serve a stale bundle
 * across app updates), and Vite's dev server already has HMR.
 */
export function registerServiceWorker() {
  if (typeof window === 'undefined') return
  if (!import.meta.env?.PROD) return
  if (isNativeShell()) return
  if (!('serviceWorker' in window.navigator)) return

  const register = () => {
    window.navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        // A worker waiting from a previous deploy can take over immediately:
        // the page already has its own hashed assets loaded.
        if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' })
      })
      .catch(() => {
        /* private mode, unsupported context, or a transient network error */
      })
  }

  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
