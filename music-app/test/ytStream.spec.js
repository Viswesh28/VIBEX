// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest'
import {
  AUDIO_ITAGS,
  STREAM_STATE,
  cachedStreams,
  forgetStream,
  invalidateStreams,
  itagOf,
  mintYtStream,
  normalizeCapturedUrl,
  parseContentRange,
  pickAudioFormat,
  readStreamMint,
  streamFailureCopy,
  streamMintBridge,
  streamTtl,
  validateProbe,
} from '../src/lib/ytStream.js'

/**
 * The device-side stream mint.
 *
 * Everything here is the *decision* half of the feature: what counts as a
 * playable URL, what counts as a preview, when a retry is worth it, and when a
 * failure is final. The WebView half needs Android and a device, so it is the
 * only part that cannot be exercised here — which is exactly why the decisions
 * were pulled out of it.
 */

/** The measured preview from the sourcing notes: itag 251, ~61 s of 268 s. */
const PREVIEW = {
  url: 'https://rr1---sn-x.googlevideo.com/videoplayback?itag=251&expire=1893456000&ip=49.1.2.3&sig=AA&n=BB&clen=4812310&range=0-1040807&rn=1&rbuf=0',
  served: 1_040_807,
  declared: 4_812_310,
  bitrate: 144_000,
  durationMs: 268_000,
}

const WHOLE = {
  url: 'https://rr1---sn-x.googlevideo.com/videoplayback?itag=251&expire=1893456000&ip=49.1.2.3&sig=AA&n=BB&clen=4812310',
  served: 4_812_310,
  declared: 4_812_310,
  bitrate: 144_000,
  durationMs: 268_000,
}

const AUDIO_FORMATS = [
  { itag: 251, mimeType: 'audio/webm; codecs="opus"', url: 'https://g/videoplayback?itag=251', bitrate: 144000, contentLength: '4812310' },
  { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', url: 'https://g/videoplayback?itag=140', bitrate: 129000 },
  { itag: 137, mimeType: 'video/mp4; codecs="avc1"', url: 'https://g/videoplayback?itag=137', bitrate: 2000000 },
]

/** A bridge that answers in order, so a re-mint is countable. */
const scriptedBridge = (answers) => {
  let i = 0
  const calls = []
  return {
    calls,
    async mintStream(args) {
      calls.push(args)
      const a = answers[Math.min(i, answers.length - 1)]
      i += 1
      return a
    },
  }
}

const goodMint = (probe = { headStatus: 206, contentRange: `bytes 0-0/${WHOLE.served}`, tailStatus: 206 }) => ({
  ok: true,
  url: WHOLE.url,
  itag: 251,
  mime: 'audio/webm; codecs="opus"',
  clen: WHOLE.declared,
  bitrate: WHOLE.bitrate,
  durationMs: WHOLE.durationMs,
  probe,
})

beforeEach(() => {
  invalidateStreams()
})

describe('picking a format', () => {
  it('takes audio-only, and never a muxed video rendition', () => {
    const pick = pickAudioFormat(AUDIO_FORMATS)
    expect(pick.itag).toBe(251)
    expect(pick.mime.startsWith('audio/')).toBe(true)
  })

  it('prefers opus, then AAC, before falling back to bitrate', () => {
    const noOpus = pickAudioFormat(AUDIO_FORMATS.filter((f) => f.itag !== 251))
    expect(noOpus.itag).toBe(140)
    const unknown = pickAudioFormat([
      { itag: 999, mimeType: 'audio/mp4', url: 'https://g/x', bitrate: 100 },
      { itag: 998, mimeType: 'audio/mp4', url: 'https://g/y', bitrate: 900 },
    ])
    expect(unknown.itag).toBe(998)
  })

  it('refuses a track that only offers video, rather than streaming 4× the bytes', () => {
    expect(pickAudioFormat([AUDIO_FORMATS[2]])).toBeNull()
    expect(pickAudioFormat([])).toBeNull()
    expect(pickAudioFormat(undefined)).toBeNull()
  })

  it('leaves no format unranked: every preference is a real audio itag', () => {
    expect(AUDIO_ITAGS).toEqual([251, 250, 249, 140, 139])
    expect(itagOf(WHOLE.url)).toBe(251)
    expect(itagOf('https://g/videoplayback')).toBe(-1)
  })
})

describe('normalising a captured URL', () => {
  it('strips the params that pin a byte window', () => {
    const n = normalizeCapturedUrl(PREVIEW.url)
    expect(n.url).not.toMatch(/[?&]range=/)
    expect(n.url).not.toMatch(/[?&]rn=/)
    expect(n.url).not.toMatch(/[?&]rbuf=/)
  })

  it('keeps the signature, because removing it is a 403', () => {
    const n = normalizeCapturedUrl(PREVIEW.url)
    expect(n.url).toContain('expire=1893456000')
    expect(n.url).toContain('ip=49.1.2.3')
    expect(n.url).toContain('sig=AA')
    expect(n.url).toContain('n=BB')
    expect(n.url).toContain('clen=4812310')
  })

  it('drops a duplicated param the page appended twice', () => {
    const n = normalizeCapturedUrl('https://g/videoplayback?itag=251&range=0-99&range=0-199&expire=1')
    expect(n.url.match(/range=/g)).toBeNull()
    expect(n.url).toBe('https://g/videoplayback?itag=251&expire=1')
  })

  it('reads the declared length and the expiry out of the URL itself', () => {
    const n = normalizeCapturedUrl(WHOLE.url)
    expect(n.clen).toBe(4812310)
    expect(n.expireAt).toBe(1893456000 * 1000)
  })

  it('rejects anything that is not a URL with a query', () => {
    expect(normalizeCapturedUrl('not a url')).toBeNull()
    expect(normalizeCapturedUrl('https://g/videoplayback')).toBeNull()
    expect(normalizeCapturedUrl('')).toBeNull()
  })
})

describe('the validity gate', () => {
  it('passes a URL that serves the whole file and reaches its last byte', () => {
    const v = validateProbe({
      headStatus: 206,
      contentRange: `bytes 0-0/${WHOLE.served}`,
      tailStatus: 206,
      declaredClen: WHOLE.declared,
      bitrate: WHOLE.bitrate,
      durationMs: WHOLE.durationMs,
    })
    expect(v.ok).toBe(true)
  })

  it('catches the measured 1 MiB preview with the declared length', () => {
    // 1 040 807 B served of a declared 4 812 310 B: this is the bug that would
    // otherwise stop playback 61 s into a 268 s track, looking like a hiccup.
    const v = validateProbe({
      headStatus: 206,
      contentRange: `bytes 0-0/${PREVIEW.served}`,
      tailStatus: 206,
      declaredClen: PREVIEW.declared,
      bitrate: PREVIEW.bitrate,
      durationMs: PREVIEW.durationMs,
    })
    expect(v.ok).toBe(false)
    expect(v.reason).toBe(STREAM_STATE.previewTruncated)
  })

  it('catches the same truncation when the URL declares no length at all', () => {
    // Belt and braces: bitrate × duration says the file should be ~4.8 MB.
    const v = validateProbe({
      headStatus: 206,
      contentRange: `bytes 0-0/${PREVIEW.served}`,
      tailStatus: 206,
      declaredClen: 0,
      bitrate: PREVIEW.bitrate,
      durationMs: PREVIEW.durationMs,
    })
    expect(v.ok).toBe(false)
    expect(v.reason).toBe(STREAM_STATE.shortFile)
  })

  it('treats an unreachable tail as the preview, whatever the declared length says', () => {
    const v = validateProbe({
      headStatus: 206,
      contentRange: `bytes 0-0/${WHOLE.served}`,
      tailStatus: 403,
      declaredClen: WHOLE.declared,
    })
    expect(v.ok).toBe(false)
    expect(v.reason).toBe(STREAM_STATE.previewTruncated)
  })

  it('distinguishes a dead URL from an unverifiable one', () => {
    expect(validateProbe({ headStatus: 403 }).reason).toBe(STREAM_STATE.expired)
    expect(validateProbe({ headStatus: 200, contentRange: '' }).reason).toBe(STREAM_STATE.notRanged)
    expect(
      validateProbe({ headStatus: 206, contentRange: 'bytes 0-0/*', tailStatus: 206 }).reason
    ).toBe(STREAM_STATE.notRanged)
    expect(
      validateProbe({
        headStatus: 206,
        contentRange: `bytes 0-0/${WHOLE.served}`,
        tailStatus: 500,
      }).reason
    ).toBe(STREAM_STATE.tailUnreachable)
  })

  it('reads a Content-Range total and refuses one it cannot parse', () => {
    expect(parseContentRange('bytes 0-0/4812310')).toBe(4812310)
    expect(parseContentRange('bytes 0-0/*')).toBeNull()
    expect(parseContentRange(undefined)).toBeNull()
  })
})

describe('expiry', () => {
  it('trusts a URL until its own expire, minus a margin', () => {
    const now = 1_000_000
    const url = `https://g/videoplayback?expire=${Math.floor(now / 1000) + 3600}`
    expect(streamTtl(url, now)).toBe(3600 * 1000 - 5 * 60 * 1000)
  })

  it('caps a long-lived signature, and never returns a negative ttl', () => {
    const now = 1_000_000
    const far = `https://g/x?expire=${Math.floor(now / 1000) + 48 * 3600}`
    expect(streamTtl(far, now)).toBe(4 * 60 * 60 * 1000)
    const dead = `https://g/x?expire=${Math.floor(now / 1000) - 10}`
    expect(streamTtl(dead, now)).toBe(0)
  })
})

describe('reading the native answer', () => {
  it('treats a bot challenge as decisive even when the page loaded', () => {
    const r = readStreamMint({ ok: true, url: WHOLE.url, blocked: true, blockReason: 'Sign in' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe(STREAM_STATE.blocked)
  })

  it('maps each native why onto a typed reason', () => {
    expect(readStreamMint({ ok: false, why: 'no_direct_audio' }).reason).toBe(STREAM_STATE.noDirectAudio)
    expect(readStreamMint({ ok: false, why: 'no_hits' }).reason).toBe(STREAM_STATE.noHits)
    expect(readStreamMint({ ok: false, why: 'Sign in to confirm' }).reason).toBe(STREAM_STATE.blocked)
    expect(readStreamMint({ ok: false, why: 'timeout' }).reason).toBe(STREAM_STATE.failed)
  })

  it('normalises the URL it was handed rather than trusting it verbatim', () => {
    const r = readStreamMint({ ok: true, url: PREVIEW.url, itag: 251 })
    expect(r.ok).toBe(true)
    expect(r.url).not.toMatch(/[?&]range=/)
    expect(r.itag).toBe(251)
  })

  it('refuses junk without throwing', () => {
    expect(readStreamMint(null).ok).toBe(false)
    expect(readStreamMint({ ok: true }).reason).toBe(STREAM_STATE.failed)
    expect(readStreamMint({ ok: true, url: 'garbage' }).reason).toBe(STREAM_STATE.failed)
  })
})

describe('minting', () => {
  it('returns a validated URL and caches it for the next play', async () => {
    const bridge = scriptedBridge([goodMint()])
    const first = await mintYtStream({ videoId: 'J7p4bzqLvCw', bridge, now: 1000 })
    expect(first.ok).toBe(true)
    expect(first.state).toBe(STREAM_STATE.ready)

    const second = await mintYtStream({ videoId: 'J7p4bzqLvCw', bridge, now: 2000 })
    expect(second.state).toBe(STREAM_STATE.cached)
    expect(bridge.calls).toHaveLength(1)
  })

  it('never returns a URL it has not probed', async () => {
    const bridge = scriptedBridge([{ ...goodMint(), probe: null }])
    const res = await mintYtStream({ videoId: 'J7p4bzqLvCw', bridge })
    expect(res.ok).toBe(false)
    expect(bridge.calls).toHaveLength(2) // one attempt, one re-mint, then stop
  })

  it('re-mints exactly once when the URL comes back dead', async () => {
    const bridge = scriptedBridge([
      goodMint({ headStatus: 403 }),
      goodMint({ headStatus: 206, contentRange: `bytes 0-0/${WHOLE.served}`, tailStatus: 206 }),
    ])
    const res = await mintYtStream({ videoId: 'J7p4bzqLvCw', bridge })
    expect(res.ok).toBe(true)
    expect(bridge.calls).toHaveLength(2)
  })

  it('stops after one re-mint and reports the reason', async () => {
    const bridge = scriptedBridge([goodMint({ headStatus: 403 })])
    const res = await mintYtStream({ videoId: 'J7p4bzqLvCw', bridge })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(STREAM_STATE.expired)
    expect(bridge.calls).toHaveLength(2)
  })

  it('does not retry a preview or a bot challenge', async () => {
    const previewBridge = scriptedBridge([
      goodMint({
        headStatus: 206,
        contentRange: `bytes 0-0/${PREVIEW.served}`,
        tailStatus: 403,
      }),
    ])
    const preview = await mintYtStream({ videoId: 'J7p4bzqLvCw', bridge: previewBridge })
    expect(preview.reason).toBe(STREAM_STATE.previewTruncated)
    expect(previewBridge.calls).toHaveLength(1)

    const gated = scriptedBridge([{ ok: false, blocked: true, blockReason: 'Sign in' }])
    const blocked = await mintYtStream({ videoId: 'J7p4bzqLvCw', bridge: gated })
    expect(blocked.reason).toBe(STREAM_STATE.blocked)
    // Looping mints is how an address gets flagged: a challenge is terminal.
    expect(gated.calls).toHaveLength(1)
  })

  it('says so when the build has no bridge, and when the id is not one', async () => {
    expect((await mintYtStream({ videoId: 'J7p4bzqLvCw', bridge: null })).reason).toBe(
      STREAM_STATE.noBridge
    )
    const bridge = scriptedBridge([goodMint()])
    expect((await mintYtStream({ videoId: 'nope', bridge })).reason).toBe(STREAM_STATE.failed)
    expect(bridge.calls).toHaveLength(0)
  })

  it('survives a bridge that throws', async () => {
    const bridge = {
      async mintStream() {
        throw new Error('boom')
      },
    }
    const res = await mintYtStream({ videoId: 'J7p4bzqLvCw', bridge })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(STREAM_STATE.failed)
  })
})

describe('invalidation', () => {
  it('drops a cached URL on a network change, because ip= is in the signature', async () => {
    const bridge = scriptedBridge([goodMint(), goodMint()])
    await mintYtStream({ videoId: 'J7p4bzqLvCw', bridge, now: 1000 })
    expect(cachedStreams().size).toBe(1)

    invalidateStreams()
    expect(cachedStreams().size).toBe(0)

    const again = await mintYtStream({ videoId: 'J7p4bzqLvCw', bridge, now: 2000 })
    expect(again.ok).toBe(true)
    expect(bridge.calls).toHaveLength(2)
  })

  it('can forget one track without touching the others', async () => {
    const bridge = scriptedBridge([goodMint()])
    await mintYtStream({ videoId: 'J7p4bzqLvCw', bridge, now: 1000 })
    forgetStream('J7p4bzqLvCw')
    expect(cachedStreams().size).toBe(0)
  })

  it('does not serve a cached URL past its ttl', async () => {
    const bridge = scriptedBridge([goodMint(), goodMint()])
    await mintYtStream({ videoId: 'J7p4bzqLvCw', bridge, now: 1000 })
    const later = 1000 + 5 * 60 * 60 * 1000
    await mintYtStream({ videoId: 'J7p4bzqLvCw', bridge, now: later })
    expect(bridge.calls).toHaveLength(2)
  })
})

describe('the bridge', () => {
  const cap = (platform, plugin) => ({
    Capacitor: {
      isNativePlatform: () => platform !== 'web',
      getPlatform: () => platform,
      Plugins: plugin === undefined ? {} : { CanvasMint: plugin },
    },
  })

  it('is absent in a browser tab, which has no page to mint from', () => {
    expect(streamMintBridge({ Capacitor: { isNativePlatform: () => false } })).toBeNull()
    expect(streamMintBridge({})).toBeNull()
    expect(streamMintBridge(null)).toBeNull()
  })

  it('is absent on iOS, where an offscreen mint fails invisibly', () => {
    const bridge = { mintStream: async () => ({ ok: false }) }
    expect(streamMintBridge(cap('ios', bridge))).toBeNull()
  })

  it('is absent when the build has the plugin but not this method', () => {
    expect(streamMintBridge(cap('android', { mint: async () => ({}) }))).toBeNull()
  })

  it('is the plugin when Android has a stream mint', () => {
    const bridge = { mintStream: async () => ({ ok: false }) }
    expect(streamMintBridge(cap('android', bridge))).toBe(bridge)
  })
})

describe('copy', () => {
  it('has a sentence for every reason that names what went wrong', () => {
    for (const state of Object.values(STREAM_STATE)) {
      if (state === STREAM_STATE.ready || state === STREAM_STATE.cached) continue
      const copy = streamFailureCopy(state)
      expect(copy, state).toBeTruthy()
      // The preview/short-file family must not read as a network problem.
      expect(copy).not.toMatch(/internet|connection dropped/i)
    }
  })
})
