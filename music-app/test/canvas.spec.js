// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  CANVAS_HEALTH,
  CANVAS_REASON,
  canvasDecision,
  canvasHealthGate,
  canvasQuery,
  pickCanvasUrl,
  readCanvasHealth,
  readCanvasResponse,
} from '../src/lib/canvas.js'

describe('canvasDecision', () => {
  const open = { open: true, hasTrack: true }

  it('only asks while the full player is open', () => {
    expect(canvasDecision(open)).toEqual({ ask: true, reason: CANVAS_REASON.ready })
    expect(canvasDecision({ ...open, open: false })).toEqual({
      ask: false,
      reason: CANVAS_REASON.closed,
    })
  })

  it('never calls a second provider under Data Saver', () => {
    expect(canvasDecision({ ...open, dataSaver: true })).toEqual({
      ask: false,
      reason: CANVAS_REASON.dataSaver,
    })
  })

  it('reports the listener’s own choice before an automatic one', () => {
    // Both are true; "you turned it off" is the honest answer, and telling
    // someone Data Saver did it would be blaming the wrong cause.
    expect(canvasDecision({ ...open, dataSaver: true, enabled: false }).reason).toBe(
      CANVAS_REASON.disabled
    )
  })

  it('respects the explicit off switch and an empty deck', () => {
    expect(canvasDecision({ ...open, enabled: false }).reason).toBe(CANVAS_REASON.disabled)
    expect(canvasDecision({ open: true, hasTrack: false }).reason).toBe(CANVAS_REASON.noTrack)
  })

  it('has copy for every reason a listener can hit', () => {
    for (const r of [
      CANVAS_REASON.dataSaver,
      CANVAS_REASON.disabled,
      CANVAS_REASON.notFound,
      CANVAS_REASON.blocked,
      CANVAS_REASON.failed,
    ]) {
      expect(r).toBeTruthy()
    }
  })
})

describe('canvasQuery', () => {
  it('drops a catalogue "(From …)" suffix that would poison the search', () => {
    expect(canvasQuery({ name: 'Gehra Hua (From "Dhurandhar")', artist: 'Arijit Singh' })).toBe(
      'Gehra Hua Arijit Singh'
    )
  })

  it('uses only the first credited artist', () => {
    expect(canvasQuery({ name: 'Song', artist: 'A, B, C' })).toBe('Song A')
  })

  it('falls back to the subtitle, then to the title alone', () => {
    expect(canvasQuery({ name: 'Song', subtitle: 'Someone' })).toBe('Song Someone')
    expect(canvasQuery({ name: 'Song' })).toBe('Song')
    expect(canvasQuery({ name: '' })).toBe('')
    expect(canvasQuery(null)).toBe('')
  })
})

describe('pickCanvasUrl', () => {
  it('prefers a URL sitting under a canvas key', () => {
    const res = {
      playerResponse: {
        thumbnail: [{ url: 'https://lh3.googleusercontent.com/abc=w60-h60-l90-rj' }],
        canvas: { url: 'https://lh3.googleusercontent.com/canvas-hash' },
      },
    }
    expect(pickCanvasUrl(res)).toMatchObject({
      url: 'https://lh3.googleusercontent.com/canvas-hash',
    })
  })

  it('finds a clip nested anywhere in the tree', () => {
    const res = { a: { b: [{ c: { video: 'https://lh3.googleusercontent.com/deep_thing=m22' } }] } }
    expect(pickCanvasUrl(res)?.url).toBe('https://lh3.googleusercontent.com/deep_thing=m22')
  })

  it('ignores thumbnails, which live on the same CDN', () => {
    const res = { thumb: [{ url: 'https://lh3.googleusercontent.com/x=w120-h120-l90-rj' }] }
    expect(pickCanvasUrl(res)).toBeNull()
  })

  it('ignores hosts outside the allowlist', () => {
    const res = { canvas: { url: 'https://evil.example.com/a.mp4' } }
    expect(pickCanvasUrl(res)).toBeNull()
  })

  it('ignores anything that is not https', () => {
    expect(pickCanvasUrl({ canvas: { url: 'http://lh3.googleusercontent.com/a' } })).toBeNull()
    expect(pickCanvasUrl({ canvas: { url: 'javascript:alert(1)' } })).toBeNull()
  })

  it('survives junk and cycles without hanging', () => {
    expect(pickCanvasUrl(null)).toBeNull()
    expect(pickCanvasUrl('nope')).toBeNull()
    const cyc = { a: {} }
    cyc.a.self = cyc
    expect(() => pickCanvasUrl(cyc)).not.toThrow()
  })
})

describe('readCanvasResponse', () => {
  it('accepts a good answer', () => {
    expect(
      readCanvasResponse({
        success: true,
        data: { videoUrl: 'https://lh3.googleusercontent.com/ok=m22', videoId: 'abc12345678' },
      })
    ).toMatchObject({ url: 'https://lh3.googleusercontent.com/ok=m22', reason: CANVAS_REASON.ready })
  })

  it('maps the route’s codes onto the reasons the UI explains', () => {
    expect(readCanvasResponse({ success: false, code: 'not_found' }).reason).toBe(
      CANVAS_REASON.notFound
    )
    expect(readCanvasResponse({ success: false, code: 'blocked' }).reason).toBe(
      CANVAS_REASON.blocked
    )
    expect(readCanvasResponse({ success: false, code: 'upstream_error' }).reason).toBe(
      CANVAS_REASON.blocked
    )
  })

  it('separates a deployment challenge from a track that has no clip', () => {
    // "Sign in to confirm you're not a bot" is about this server, not the song.
    // Reporting it as not_found would quietly blame the catalogue.
    const body = { success: false, code: 'deployment_blocked' }
    expect(readCanvasResponse(body).reason).toBe(CANVAS_REASON.deploymentBlocked)
    expect(readCanvasResponse(body).reason).not.toBe(CANVAS_REASON.notFound)
  })

  it('degrades to artwork on a malformed or hostile body', () => {
    expect(readCanvasResponse(null)).toEqual({ url: null, reason: CANVAS_REASON.failed })
    expect(readCanvasResponse({ data: { videoUrl: 'javascript:alert(1)' } }).url).toBeNull()
    expect(readCanvasResponse({ data: { videoUrl: 'https://evil.example.com/x.mp4' } }).url).toBeNull()
  })
})

describe('readCanvasHealth', () => {
  it('passes an available deployment through', () => {
    expect(readCanvasHealth({ data: { canvas: 'available' } })).toMatchObject({
      state: CANVAS_HEALTH.available,
    })
  })

  it('reports a challenged deployment as blocked, with the reason', () => {
    expect(
      readCanvasHealth({ data: { canvas: 'deployment_blocked', reason: 'Please sign in' } })
    ).toMatchObject({ state: CANVAS_HEALTH.blocked, reason: 'Please sign in' })
  })

  it('treats a failed probe as unknown, not as either verdict', () => {
    // Reading a broken probe as "available" would spend a request per track;
    // reading it as "blocked" would hide clips that do exist.
    expect(readCanvasHealth(null).state).toBe(CANVAS_HEALTH.unknown)
    expect(readCanvasHealth({ success: true }).state).toBe(CANVAS_HEALTH.unknown)
    expect(readCanvasHealth({ data: { canvas: 'nonsense' } }).state).toBe(CANVAS_HEALTH.unknown)
  })
})

describe('canvasHealthGate', () => {
  it('does not ask per track when the deployment is challenged', () => {
    expect(canvasHealthGate(CANVAS_HEALTH.blocked)).toEqual({
      ask: false,
      reason: CANVAS_REASON.deploymentBlocked,
    })
  })

  it('still asks when the probe was healthy or inconclusive', () => {
    expect(canvasHealthGate(CANVAS_HEALTH.available).ask).toBe(true)
    expect(canvasHealthGate(CANVAS_HEALTH.unknown).ask).toBe(true)
  })
})
