/**
 * Surgical native HTTP, installed once at boot on Android only.
 *
 * The embedded JioSaavn API calls `fetch` internally, and jiosaavn.com sends
 * no CORS headers — so those calls, and only those, have to leave the WebView
 * through the native stack (`CapacitorHttp`, i.e. OkHttp), which has no
 * same-origin policy and lets us set a real `User-Agent`.
 *
 * Capacitor can patch `fetch` globally via `plugins.CapacitorHttp.enabled`,
 * but that routes *everything* native, including the multi-megabyte audio
 * download — which would be base64'd across the JS bridge for no reason. The
 * CDN already sends `Access-Control-Allow-Origin: *`, so big transfers are
 * better left on the WebView's own stack.
 *
 * Hence a single permanent wrapper that delegates by hostname. Installing it
 * once (rather than swapping `globalThis.fetch` around each call) matters:
 * the home feed fires four searches in parallel, and a swap would race.
 *
 * For the same reason the wrapper holds no shared in-flight state. An earlier
 * version used a single `depth` counter as a recursion guard, which meant the
 * second of those four parallel searches saw `depth > 0` and fell through to
 * the WebView's fetch — where jiosaavn.com has no CORS headers, so it failed.
 * Recursion is now prevented by only installing when a native implementation
 * is advertised; see nativeHttpAdvertised().
 */
const NATIVE_HOSTS = /(^|\.)jiosaavn\.com$/i

let installed = false

/**
 * Deliberately *not* `isNative()` from config.js.
 *
 * That helper honours the `__VIBEX_NATIVE` QA override, and patching fetch in
 * a real browser is catastrophic: the web build of CapacitorHttp implements
 * `request()` by calling `window.fetch`, so the patch would call the plugin,
 * which would call the patch... until the renderer dies. Only a genuine
 * device, where the plugin crosses the native bridge, may be patched.
 */
const onDevice = () =>
  typeof window !== 'undefined' &&
  !!window.Capacitor?.isNativePlatform?.() &&
  window.Capacitor?.getPlatform?.() !== 'web'

/**
 * True only when the bridge advertises a *native* CapacitorHttp.
 *
 * This is what makes the patch safe to install. A native `request()` crosses
 * the JS bridge and can never re-enter `window.fetch`, so no recursion guard
 * is needed. If the header is missing, `registerPlugin` would silently hand
 * back the **web** implementation — which is literally `window.fetch` — and
 * patching would recurse until the renderer dies. In that case we patch
 * nothing and leave the WebView's own stack alone.
 */
const nativeHttpAdvertised = () =>
  Array.isArray(window.Capacitor?.PluginHeaders) &&
  window.Capacitor.PluginHeaders.some((h) => h?.name === 'CapacitorHttp')

export async function installNativeHttp() {
  if (installed || !onDevice() || !nativeHttpAdvertised()) return
  installed = true

  let CapacitorHttp
  try {
    ;({ CapacitorHttp } = await import('@capacitor/core'))
    if (!CapacitorHttp?.request) return
  } catch {
    return
  }

  const original = globalThis.fetch.bind(globalThis)

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || String(input)

    let host = ''
    try {
      host = new URL(url).hostname
    } catch {
      return original(input, init)
    }
    if (!NATIVE_HOSTS.test(host)) return original(input, init)

    // Headers can arrive as a Headers instance, an array or a plain object.
    const headers = {}
    const src = (typeof input === 'object' && input?.headers) || init.headers
    if (src) {
      if (typeof src.forEach === 'function' && !Array.isArray(src)) src.forEach((v, k) => (headers[k] = v))
      else for (const [k, v] of Array.isArray(src) ? src : Object.entries(src)) headers[k] = v
    }

    try {
      const res = await CapacitorHttp.request({
        url,
        method: init.method || 'GET',
        headers,
        responseType: 'json',
      })
      // CapacitorHttp hands back parsed data; rebuild a real Response so the
      // caller's `.json()` / `.ok` checks behave exactly as on the web.
      const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? null)
      return new Response(body, {
        status: res.status || 200,
        headers: { 'content-type': 'application/json' },
      })
    } catch {
      // Falling back to the WebView's fetch will almost certainly hit CORS,
      // but a real network error is a better signal than a silent hang.
      return original(input, init)
    }
  }
}
