/**
 * Where the backend lives — on the web only.
 *
 * The web build is served by the gateway, which also proxies /api, so this
 * stays empty and relative URLs do the right thing. Override it at build time
 * if you ever serve the UI from somewhere other than the gateway:
 *
 *   VITE_API_ORIGIN=https://api.example.com npm run build
 *
 * The Android build ignores all of this: it embeds the API and downloads
 * in-process, so it has no backend to address. See src/lib/embedded-api.js.
 */
export const API_ORIGIN = (import.meta.env?.VITE_API_ORIGIN || '').replace(/\/+$/, '')

export const apiUrl = (path) => `${API_ORIGIN}/api${path}`
// Downloads hit the tagger function directly. It used to be reachable as /dl
// through a hosting rewrite, but a deployment that carries only the app build
// has no rewrite table, so the path the function actually owns is the safe one.
export const dlUrl = (query) => `${API_ORIGIN}/api/dl?${query}`

/**
 * True when running inside the native shell rather than a browser tab.
 *
 * `window.__VIBEX_NATIVE = true` forces the native code path on in a desktop
 * browser. Debugging inside a WebView is painful, and without this there is no
 * way to exercise the embedded API from devtools — or from a test. It must be
 * set before the app's scripts run, and a browser will still be CORS-blocked
 * talking to JioSaavn, so it proves routing rather than end-to-end success.
 */
export const isNative = () =>
  typeof window !== 'undefined' &&
  (!!window.Capacitor?.isNativePlatform?.() || window.__VIBEX_NATIVE === true)
