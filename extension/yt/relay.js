/**
 * Isolated-world relay on music.youtube.com.
 *
 * The service worker cannot read page variables and the page world cannot talk
 * to `chrome.*`; this sits between them and does one thing: a request comes in
 * over `chrome.runtime`, is forwarded to the harvester over `postMessage`, and
 * the answer goes back.
 */
;(() => {
  const pending = new Map()
  let seq = 0

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data
    if (!data || data.__vibex !== 'harvest-result') return
    const entry = pending.get(data.id)
    if (!entry) return
    pending.delete(data.id)
    entry(data)
  })

  const ask = () =>
    new Promise((resolve) => {
      const id = ++seq
      const timer = setTimeout(() => {
        if (pending.delete(id)) resolve(null)
      }, 1200)
      pending.set(id, (msg) => {
        clearTimeout(timer)
        resolve(msg)
      })
      window.postMessage({ __vibex: 'harvest-request', id }, '*')
    })

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'vibex:harvest') return undefined
    ask().then((msg) => sendResponse(msg || { payload: { ok: false, why: 'no_hits' } }))
    // Keep the channel open for the async reply.
    return true
  })
})()
