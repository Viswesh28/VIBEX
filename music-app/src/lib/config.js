/**
 * Backend origin & native shell detection.
 *
 * - Web deployments serve `/api/*` on the same origin (`API_ORIGIN = ""`).
 * - The native Android APK (`window.VibexAndroid`) intercepts `/api/*` natively on
 *   same-origin `https://appassets.androidplatform.net/api/*`, executing YouTube
 *   InnerTube pure-audio extraction directly on the phone's residential IP and
 *   proxying catalog calls seamlessly to `https://vibex-music-pi.vercel.app`.
 * - `window.__VIBEX_NATIVE = true` activates the pure-JS embedded JioSaavn harness
 *   used by unit tests (`test/embedded-api*.spec.js`).
 */
export const API_ORIGIN = (import.meta.env?.VITE_API_ORIGIN || '').replace(/\/+$/, '')

export const ANDROID_APK_URL = '/downloads/VIBEX-v3.2.0-universal.apk'
export const ANDROID_APP_VERSION = '3.2.0'
export const ANDROID_PACKAGE_ID = 'dev.viswesh.vibex'

export const apiUrl = (path) => `${API_ORIGIN}/api${path}`
export const dlUrl = (query) => `${API_ORIGIN}/api/dl?${query}`

/** True when running inside the compiled VIBEX Android native WebView bridge. */
export const hasAndroidBridge = () =>
  typeof window !== 'undefined' && Boolean(window.VibexAndroid)

/**
 * True when running inside Capacitor or test-forced native mode.
 * Kept distinct from `hasAndroidBridge()` so `api.js` unit tests stay 100% deterministic.
 */
export const isNative = () =>
  typeof window !== 'undefined' &&
  (!!window.Capacitor?.isNativePlatform?.() || window.__VIBEX_NATIVE === true)

/** True inside any native Android / mobile app container. */
export const isNativeApp = () => hasAndroidBridge() || isNative()
