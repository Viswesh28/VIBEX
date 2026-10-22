/**
 * Isolated-world half of the app bridge: the only part that may touch `chrome.*`.
 *
 * It relays the page's mint request to the service worker and the answer back.
 * It never decides anything — the gate lives in the app (`ytStream.js`), so
 * there is one copy of that logic and it is the tested one.
 */
;(() => {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data
    if (!data || data.__vibex !== 'mint-request') return

    const reply = (payload) => {
      window.postMessage({ __vibex: 'mint-result', id: data.id, payload }, '*')
    }

    try {
      chrome.runtime.sendMessage({ type: 'vibex:mint', videoId: data.videoId }, (res) => {
        if (chrome.runtime.lastError || !res) {
          reply({ ok: false, why: 'extension_error' })
          return
        }
        reply(res)
      })
    } catch {
      reply({ ok: false, why: 'extension_error' })
    }
  })
})()
