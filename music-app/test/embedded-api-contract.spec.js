// @vitest-environment node
//
// Guards the two invariants that the Android build's in-process API depends on
// and that a dependency bump can quietly break.
import { describe, expect, it, vi } from 'vitest'
import { embeddedFetch } from '../src/lib/embedded-api.js'

const upstreamDown = () =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 429, json: async () => null })

describe('the embedded API always answers in the JSON envelope', () => {
  // src/lib/api.js does `await response.json()` and then reads `.success`. A
  // plain-text 500 makes it throw "The API returned an invalid response", which
  // tells the user nothing. This regressed once already: music-app and
  // jiosaavn-api each installed their own @hono/zod-openapi, and a sub-app
  // built on one copy mounted into an app from the other silently drops its
  // onError handler. Both configs alias the specifier to a single copy.
  it('returns JSON, not Hono\'s plain-text 500, when the upstream call fails', async () => {
    upstreamDown()
    const res = await embeddedFetch('/api/search/songs?query=x&limit=1')

    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toContain('application/json')

    const body = await res.json() // must not throw
    expect(body.success).toBe(false)
    expect(typeof body.message).toBe('string')
    expect(body.message.length).toBeGreaterThan(0)
  })

  it('matches the hosted API\'s envelope, so web and Android behave the same', async () => {
    upstreamDown()
    const embedded = await (await embeddedFetch('/api/search/songs?query=x&limit=1')).json()

    const { default: hosted } = await import('jiosaavn-api/src/server.js')
    const fromServer = await (
      await hosted.fetch(new Request('http://x/api/search/songs?query=x&limit=1'))
    ).json()

    expect(embedded.success).toBe(fromServer.success)
    expect(Object.keys(embedded).sort()).toEqual(Object.keys(fromServer).sort())
  })
})

// No separate "same module instance" assertion: jiosaavn-api's `exports` map
// deliberately does not expose its own node_modules, so the copy cannot be
// imported directly. The two tests above are the real guard — if the alias in
// vite.config.js / vitest.config.js is ever dropped, the router and the
// controllers get built from two copies again and the envelope test fails.
