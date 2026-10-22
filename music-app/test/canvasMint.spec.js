// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_RESPONSE_CHARS,
  MINT_STATE,
  canvasMintBridge,
  canvasTransport,
  forgetMint,
  mintCanvas,
  mintReason,
  mintTtl,
  pickMintedCanvas,
  readMintResult,
} from '../src/lib/canvasMint.js'
import { CANVAS_REASON } from '../src/lib/canvas.js'

/** A player response shaped like the ones the page actually holds. */
function playerResponse(extra = {}) {
  return {
    playabilityStatus: { status: 'OK' },
    streamingData: {
      adaptiveFormats: [
        {
          itag: 140,
          mimeType: 'audio/mp4',
          url: 'https://rr1---sn-a.googlevideo.com/videoplayback?expire=9999999999',
        },
        {
          itag: 137,
          mimeType: 'video/mp4',
          url: 'https://rr1---sn-b.googlevideo.com/videoplayback2',
        },
      ],
    },
    canvas: { thumbnail: { thumbnails: [{ url: 'https://lh3.googleusercontent.com/loop=m22' }] } },
    ...extra,
  }
}

function fakeBridge(result) {
  return { mint: vi.fn(async () => result) }
}

describe('canvasMintBridge', () => {
  const plugin = { mint: () => {} }

  it('is absent in a browser tab, and on iOS', () => {
    expect(canvasMintBridge({})).toBeNull()
    expect(canvasMintBridge({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } })).toBeNull()
  })

  it('is absent when the shell is native but the plugin is not registered', () => {
    // Capacitor exposes `Plugins.X` as a proxy even on web, so presence alone
    // proves nothing — the method has to be there.
    const win = {
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} },
    }
    expect(canvasMintBridge(win)).toBeNull()
    expect(
      canvasMintBridge({
        Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { CanvasMint: {} } },
      })
    ).toBeNull()
  })

  it('finds the plugin on an Android shell', () => {
    const win = {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        Plugins: { CanvasMint: plugin },
      },
    }
    expect(canvasMintBridge(win)).toBe(plugin)
    expect(canvasTransport(plugin)).toBe('mint')
    expect(canvasTransport(null)).toBe('server')
  })
})

describe('readMintResult', () => {
  it('rejects junk without throwing', () => {
    expect(readMintResult(null)).toMatchObject({ ok: false, state: MINT_STATE.failed })
    expect(readMintResult('nope')).toMatchObject({ ok: false, state: MINT_STATE.failed })
  })

  it('reads a refusal as blocked when the reason mentions a challenge', () => {
    expect(readMintResult({ ok: false, why: 'bot_challenge' })).toMatchObject({
      state: MINT_STATE.blocked,
    })
    expect(readMintResult({ ok: false, blocked: true, blockReason: 'Sign in to confirm' })).toMatchObject({
      state: MINT_STATE.blocked,
    })
  })

  it('keeps a plain failure plain', () => {
    expect(readMintResult({ ok: false, why: 'timeout' })).toMatchObject({
      state: MINT_STATE.failed,
      reason: 'timeout',
    })
  })

  it('refuses a response too large to be worth the bridge', () => {
    const huge = 'x'.repeat(MAX_RESPONSE_CHARS + 1)
    expect(readMintResult({ ok: true, response: huge })).toMatchObject({
      state: MINT_STATE.failed,
      reason: 'response_too_large',
    })
  })

  it('passes a good response through', () => {
    expect(readMintResult({ ok: true, response: '{"a":1}' })).toMatchObject({
      ok: true,
      state: MINT_STATE.ready,
    })
  })
})

describe('pickMintedCanvas', () => {
  it('accepts a URL that sits under a canvas key', () => {
    const picked = pickMintedCanvas(playerResponse())
    expect(picked).toMatchObject({ url: 'https://lh3.googleusercontent.com/loop=m22', state: MINT_STATE.ready })
    expect(picked.path).toMatch(/canvas/i)
  })

  it('parses a response handed over as a string', () => {
    expect(pickMintedCanvas(JSON.stringify(playerResponse())).url).toBeTruthy()
  })

  it('refuses the music video when nothing identifies it as a canvas', () => {
    // Showing the official video where a 3-second loop belongs is the fake this
    // project refuses; the adaptive formats are not a canvas.
    const videoOnly = playerResponse()
    delete videoOnly.canvas
    expect(pickMintedCanvas(videoOnly)).toMatchObject({ url: null, state: MINT_STATE.noCanvas })
  })

  it('refuses a media URL that is not identified as a canvas', () => {
    const ambiguous = {
      // A CDN URL on an allowed host, but under no canvas key at all.
      contents: [{ url: 'https://lh3.googleusercontent.com/some-clip=m22' }],
    }
    expect(pickMintedCanvas(ambiguous)).toMatchObject({
      url: null,
      state: MINT_STATE.noCanvas,
      reason: 'not_a_canvas',
    })
  })

  it('reports a sign-in gate as blocked, not as a track without a canvas', () => {
    const gated = playerResponse({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Please sign in' } })
    expect(pickMintedCanvas(gated)).toMatchObject({ state: MINT_STATE.blocked, reason: 'Please sign in' })
  })

  it('survives an unparseable body', () => {
    expect(pickMintedCanvas('{oops')).toMatchObject({ url: null, state: MINT_STATE.failed })
    expect(pickMintedCanvas(null)).toMatchObject({ url: null, state: MINT_STATE.failed })
  })

  it('never accepts a non-Google host, even under a canvas key', () => {
    const hostile = {
      canvas: { thumbnail: { thumbnails: [{ url: 'https://evil.example.com/loop.mp4' }] } },
    }
    expect(pickMintedCanvas(hostile).url).toBeNull()
  })
})

describe('mintTtl', () => {
  it('derives the lifetime from the URL’s own expire, minus a margin', () => {
    const now = 1_700_000_000_000
    const expire = Math.floor((now + 3_600_000) / 1000)
    expect(mintTtl(`https://x.googlevideo.com/v?expire=${expire}`, now)).toBe(3_600_000 - 300_000)
  })

  it('treats an already-expired URL as unusable', () => {
    const now = 1_700_000_000_000
    const expire = Math.floor((now - 1000) / 1000)
    expect(mintTtl(`https://x.googlevideo.com/v?expire=${expire}`, now)).toBe(0)
  })

  it('falls back to an hour when the URL carries no expiry', () => {
    expect(mintTtl('https://lh3.googleusercontent.com/loop=m22')).toBe(3_600_000)
  })
})

describe('mintCanvas', () => {
  beforeEach(() => {
    forgetMint('q')
    forgetMint('abc12345678')
  })

  it('hands the query to the platform, since the catalogue has no video ids', async () => {
    const bridge = fakeBridge({ ok: true, response: JSON.stringify(playerResponse()) })
    const result = await mintCanvas({ query: 'q', bridge })
    expect(bridge.mint).toHaveBeenCalledWith({ videoId: undefined, query: 'q' })
    expect(result.url).toBeTruthy()
  })

  it('reports no bridge rather than throwing when there is none', async () => {
    expect(await mintCanvas({ query: 'q', bridge: null })).toMatchObject({ state: MINT_STATE.noBridge })
  })

  it('does not call the page without a query or an id', async () => {
    const bridge = fakeBridge({ ok: true })
    expect(await mintCanvas({ bridge })).toMatchObject({ reason: 'no_query' })
    expect(bridge.mint).not.toHaveBeenCalled()
  })

  it('turns a thrown platform error into a typed failure', async () => {
    const bridge = { mint: async () => { throw new Error('busy') } }
    expect(await mintCanvas({ query: 'q', bridge })).toMatchObject({
      state: MINT_STATE.failed,
      reason: 'busy',
    })
  })

  it('caches a hit only while the minted URL is actually valid', async () => {
    const now = 1_700_000_000_000
    const expire = Math.floor((now + 3_600_000) / 1000)
    const response = JSON.stringify({
      canvas: { thumbnail: { thumbnails: [{ url: `https://lh3.googleusercontent.com/loop=m22&expire=${expire}` }] } },
    })
    const bridge = fakeBridge({ ok: true, response })

    const first = await mintCanvas({ videoId: 'abc12345678', bridge, now })
    expect(first.url).toBeTruthy()

    const second = await mintCanvas({ videoId: 'abc12345678', bridge, now: now + 60_000 })
    expect(second).toMatchObject({ cached: true })

    // Past the minted URL's own lifetime the page has to be asked again.
    await mintCanvas({ videoId: 'abc12345678', bridge, now: now + 3_600_000 })
    expect(bridge.mint).toHaveBeenCalledTimes(2)
  })

  it('propagates a blocked page as blocked, and caches nothing', async () => {
    const bridge = fakeBridge({ ok: false, blocked: true, blockReason: 'Sign in to confirm' })
    const result = await mintCanvas({ query: 'q', bridge })
    expect(result.state).toBe(MINT_STATE.blocked)
    expect(result.url).toBeNull()
  })
})

describe('mintReason', () => {
  it('maps each mint state onto a sentence the UI already has', () => {
    expect(mintReason(MINT_STATE.blocked)).toBe(CANVAS_REASON.mintBlocked)
    expect(mintReason(MINT_STATE.noCanvas)).toBe(CANVAS_REASON.noCanvasOnPage)
    expect(mintReason(MINT_STATE.failed)).toBe(CANVAS_REASON.failed)
  })

  it('has copy for both new reasons', () => {
    // A reason without a sentence is a mystery gap in the player.
    for (const reason of [CANVAS_REASON.mintBlocked, CANVAS_REASON.noCanvasOnPage]) {
      expect(reason).toBeTruthy()
    }
  })
})
