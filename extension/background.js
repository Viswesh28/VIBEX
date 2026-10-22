/**
 * The mint, in a background tab.
 *
 * This is the browser's answer to the Android WebView: open the watch page
 * hidden, let YouTube's own player resolve the stream, read the URL, close the
 * tab. The page runs on the listener's connection with the listener's session,
 * which is the only thing YouTube will answer — and the one thing a server
 * cannot supply.
 *
 * The probe is here rather than in the page because the extension's host
 * permissions let this worker fetch `googlevideo` without CORS. A page cannot:
 * `googlevideo` grants `Access-Control-Allow-Origin` to YouTube's origins only,
 * so a tab can neither read the bytes nor see the `Content-Range` the gate
 * needs. That asymmetry is the whole reason this is an extension.
 */

const WATCH = (id) => `https://music.youtube.com/watch?v=${id}&hl=en&gl=US`
const SETTLE_MS = 1200
const MAX_POLLS = 14
const PROBE_TIMEOUT_MS = 8000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Keep only the params the player needs; range plumbing pins a byte window. */
function normalize(raw) {
  try {
    const url = new URL(raw)
    for (const key of ['range', 'rn', 'rbuf', 'rbum']) url.searchParams.delete(key)
    return url.toString()
  } catch {
    return null
  }
}

/** Ask the server what it will actually serve. 403 on the tail is a preview. */
async function probe(url) {
  const out = { headStatus: 0, tailStatus: 0, contentRange: '' }
  const get = async (range) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        headers: { Range: range },
        signal: controller.signal,
        cache: 'no-store',
      })
      // The body is never read: one byte is not audio and we do not keep it.
      try {
        await res.body?.cancel()
      } catch {
        /* ignore */
      }
      return res
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    const head = await get('bytes=0-0')
    out.headStatus = head.status
    out.contentRange = head.headers.get('Content-Range') || ''
    const total = Number(/bytes\s+\d+-\d+\/(\d+)/i.exec(out.contentRange)?.[1] || 0)
    if (!total) return out
    const tail = await get(`bytes=${Math.max(0, total - 1024)}-${total - 1}`)
    out.tailStatus = tail.status
    return out
  } catch (e) {
    out.error = String(e?.name || e)
    return out
  }
}

async function harvestFor(tabId) {
  for (let i = 0; i < MAX_POLLS; i += 1) {
    await sleep(SETTLE_MS)
    try {
      const msg = await chrome.tabs.sendMessage(tabId, { type: 'vibex:harvest' })
      if (msg?.payload?.ok) return msg.payload
      // A challenge will not become a URL by waiting.
      if (msg?.payload?.blocked) return msg.payload
      if (i > 4 && msg?.raw?.why === 'no_direct_audio') return msg.raw
    } catch {
      // The tab may still be loading; keep polling until the budget is spent.
    }
  }
  return { ok: false, why: 'no_hits' }
}

async function mint(videoId) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return { ok: false, why: 'no_video_id' }
  let tab
  try {
    tab = await chrome.tabs.create({ url: WATCH(videoId), active: false })
    const raw = await harvestFor(tab.id)
    if (!raw.ok) return raw

    const url = normalize(raw.url)
    if (!url) return { ok: false, why: 'no_url' }

    const probeResult = await probe(url)
    return { ...raw, url, clen: raw.clen || 0, ...probeResult }
  } catch (e) {
    return { ok: false, why: 'extension_error', error: String(e?.message || e) }
  } finally {
    if (tab?.id) {
      try {
        await chrome.tabs.remove(tab.id)
      } catch {
        /* the tab may already be gone */
      }
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'vibex:mint') return undefined
  mint(String(msg.videoId || '')).then(sendResponse)
  return true
})
