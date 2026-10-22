/**
 * Page-world harvester, on music.youtube.com, at document_start.
 *
 * This is the Android WebView's job, done in a browser tab with the privilege
 * Android had to fake. Two things it gets that the WebView could not:
 *
 *   * real document-start injection, so the shim's wrappers exist before the
 *     player builds its loaders (Android has no such hook without androidx.webkit);
 *   * the page's own origin, so nothing here fights CORS.
 *
 * It reports; it does not decide. Formats, captured URLs and MSE mime types go
 * back over `postMessage` to `relay.js`, and the app applies the validity gate.
 */
;(() => {
  if (window.__vibexHarvest) return
  window.__vibexHarvest = 1

  const hits = []
  const mse = []

  const keep = (u) => {
    try {
      const s = String(u)
      if (s.indexOf('googlevideo.com/videoplayback') < 0) return
      if (hits[hits.length - 1] !== s) hits.push(s)
      if (hits.length > 300) hits.shift()
    } catch {
      /* the page passes odd things to open(); ignore them */
    }
  }

  const xhrOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url) {
    keep(url)
    return xhrOpen.apply(this, arguments)
  }

  const realFetch = window.fetch
  if (realFetch) {
    window.fetch = function (input) {
      keep((input && input.url) || input)
      return realFetch.apply(this, arguments)
    }
  }

  if (window.MediaSource) {
    const add = MediaSource.prototype.addSourceBuffer
    MediaSource.prototype.addSourceBuffer = function (mime) {
      try {
        mse.push(String(mime))
      } catch {
        /* ignore */
      }
      return add.apply(this, arguments)
    }
  }

  const AUDIO_ITAGS = [251, 250, 249, 140, 139]
  const itagOf = (u) => {
    const m = /[?&]itag=(\d+)/.exec(String(u))
    return m ? Number(m[1]) : -1
  }

  /** What the page was told, before it plays anything. */
  function fromPlayerResponse() {
    const pr = window.ytInitialPlayerResponse
    const body = (document.body && document.body.innerText) || ''
    const blocked = /confirm you.{0,3}re not a bot|Sign in to confirm|Before you continue/i.test(body)
    const status = (pr && pr.playabilityStatus && pr.playabilityStatus.status) || ''
    if (blocked || /LOGIN_REQUIRED|AGE_CHECK/i.test(status)) {
      return { ok: false, blocked: true, why: 'bot_challenge' }
    }
    const sd = pr && pr.streamingData
    if (!sd) return { ok: false, why: 'no_player_response' }

    const all = (sd.adaptiveFormats || []).concat(sd.formats || [])
    const audio = all.filter(
      (f) => f && typeof f.mimeType === 'string' && f.mimeType.indexOf('audio/') === 0 && f.url
    )
    if (!audio.length) {
      // Either cipher-only (play, then read the captures) or genuinely no audio.
      const cipher = all.some((f) => f && f.signatureCipher)
      return { ok: false, why: cipher ? 'cipher_only' : 'no_direct_audio' }
    }
    const pick =
      AUDIO_ITAGS.map((t) => audio.find((f) => Number(f.itag) === t)).find(Boolean) ||
      audio.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]

    return {
      ok: true,
      url: pick.url,
      itag: pick.itag,
      mime: pick.mimeType,
      bitrate: pick.bitrate || 0,
      clen: Number(pick.contentLength) || 0,
      durationMs: (Number(pr.videoDetails && pr.videoDetails.lengthSeconds) || 0) * 1000,
    }
  }

  /** What the page actually fetched, after it started playing muted. */
  function fromCaptures() {
    if (!hits.length) return { ok: false, why: 'no_hits' }
    const pool = hits.filter((u) => AUDIO_ITAGS.indexOf(itagOf(u)) >= 0)
    if (!pool.length) return { ok: false, why: 'no_direct_audio' }
    const pick = AUDIO_ITAGS.map((t) => pool.find((u) => itagOf(u) === t)).find(Boolean) || pool[0]
    return {
      ok: true,
      url: pick,
      itag: itagOf(pick),
      mime: (mse.find((m) => /audio\//.test(m)) || 'audio/webm').split(';')[0],
      bitrate: 0,
      clen: 0,
      durationMs: 0,
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data
    if (!data || data.__vibex !== 'harvest-request') return

    let payload = fromPlayerResponse()
    if (!payload.ok && (payload.why === 'cipher_only' || payload.why === 'no_player_response')) {
      // Let the page do the work it is good at. Muted: this is a fetch, not a
      // performance, and the user is looking at our tab, not this one.
      const video = document.querySelector('video')
      if (video) {
        video.muted = true
        video.volume = 0
        try {
          video.play()
        } catch {
          /* an autoplay gate; the captures may still arrive */
        }
      }
    }
    // Report what we have now; the relay polls and will ask again, which is what
    // gives the captures time to appear without a second protocol.
    const answer = payload.ok ? payload : fromCaptures()
    window.postMessage(
      { __vibex: 'harvest-result', id: data.id, payload: answer, raw: payload },
      '*'
    )
  })
})()
