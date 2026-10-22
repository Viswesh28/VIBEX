/**
 * Page-world half of the app bridge.
 *
 * Runs in the app's own JS context, so it can install the hook the app looks
 * for — but it cannot talk to `chrome.*`. The isolated half (`bridge.js`) can,
 * and the two meet over `postMessage`. Splitting it this way is what keeps the
 * hook in the page world without giving up extension messaging.
 */
;(() => {
  if (window.__VIBEX_STREAM_MINTER) return

  const pending = new Map()
  let seq = 0

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data
    if (!data || data.__vibex !== 'mint-result') return
    const entry = pending.get(data.id)
    if (!entry) return
    pending.delete(data.id)
    entry.resolve(data.payload)
  })

  window.__VIBEX_STREAM_MINTER = {
    /**
     * Same contract as the Android plugin, deliberately: `{videoId}` in,
     * `{ok, url, itag, …, headStatus, contentRange, tailStatus}` out. The app
     * has one reader for both.
     */
    mintStream({ videoId } = {}) {
      return new Promise((resolve) => {
        const id = ++seq
        pending.set(id, { resolve })
        window.postMessage({ __vibex: 'mint-request', id, videoId: String(videoId || '') }, '*')
        // A mint opens a tab and waits for a page: slower than the WebView, so
        // the ceiling is generous. The app's own timeout is the real one.
        setTimeout(() => {
          if (pending.delete(id)) resolve({ ok: false, why: 'extension_timeout' })
        }, 30000)
      })
    },
  }
})()
