// The native fetch patch is the most dangerous code in the app: installed in a
// browser it recurses until the renderer dies, because the *web* CapacitorHttp
// implements request() by calling window.fetch. These tests pin the three gates
// that keep it on the device only.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const realFetch = globalThis.fetch

// http.js memoises `installed` at module scope, so every case needs a virgin
// module — vi.resetModules() plus a dynamic import gives us one.
beforeEach(() => {
  vi.resetModules()
  globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 }))
})

afterEach(() => {
  vi.doUnmock('@capacitor/core')
  delete window.Capacitor
  delete window.__VIBEX_NATIVE
  globalThis.fetch = realFetch
})

const loadHttp = () => import('../src/lib/http.js')

function asDevice({ advertiseNativeHttp = true } = {}) {
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    PluginHeaders: advertiseNativeHttp ? [{ name: 'CapacitorHttp' }] : [],
  }
}

function asBrowser() {
  window.Capacitor = {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
    PluginHeaders: [{ name: 'CapacitorHttp' }],
  }
}

const stubPlugin = (impl) => {
  const request =
    impl ||
    (vi.fn(async ({ url }) => ({ status: 200, data: { success: true, echo: url } })))
  vi.doMock('@capacitor/core', () => ({ CapacitorHttp: { request } }))
  return request
}

describe('installNativeHttp', () => {
  it('leaves fetch completely alone in a browser', async () => {
    asBrowser()
    const before = globalThis.fetch
    const { installNativeHttp } = await loadHttp()
    await installNativeHttp()
    expect(globalThis.fetch).toBe(before)
  })

  // window.__VIBEX_NATIVE forces the native *code path* for QA on a desktop. It
  // must never be enough to patch fetch, or the web build of CapacitorHttp would
  // call window.fetch, which is the patch, forever.
  it('does not patch for the __VIBEX_NATIVE desktop override', async () => {
    asBrowser()
    window.__VIBEX_NATIVE = true
    const before = globalThis.fetch
    const { installNativeHttp } = await loadHttp()
    await installNativeHttp()
    expect(globalThis.fetch).toBe(before)
  })

  it('does not patch when the bridge advertises no native CapacitorHttp', async () => {
    asDevice({ advertiseNativeHttp: false })
    const before = globalThis.fetch
    const { installNativeHttp } = await loadHttp()
    await installNativeHttp()
    expect(globalThis.fetch).toBe(before)
  })

  it('patches on a genuine device that advertises the native plugin', async () => {
    asDevice()
    const request = stubPlugin()
    const before = globalThis.fetch
    const { installNativeHttp } = await loadHttp()
    await installNativeHttp()
    expect(globalThis.fetch).not.toBe(before)
    expect(request).not.toHaveBeenCalled() // nothing sent until a request happens
  })

  it('routes only jiosaavn.com through the native stack', async () => {
    asDevice()
    const request = stubPlugin()
    const { installNativeHttp } = await loadHttp()
    await installNativeHttp()

    await globalThis.fetch('https://www.jiosaavn.com/api.php?__call=search.getResults')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0].url).toContain('jiosaavn.com')

    // The multi-megabyte CDN download must stay on the WebView's own stack.
    request.mockClear()
    await globalThis.fetch('https://aac.saavncdn.com/123/song_320.mp4')
    expect(request).not.toHaveBeenCalled()
  })

  it('rebuilds a real Response so callers can use .json() and .ok', async () => {
    asDevice()
    stubPlugin()
    const { installNativeHttp } = await loadHttp()
    await installNativeHttp()

    const res = await globalThis.fetch('https://www.jiosaavn.com/api.php')
    expect(res).toBeInstanceOf(Response)
    expect(res.ok).toBe(true)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toMatchObject({ success: true })
  })

  it('sends the headers the caller set, from any of the three shapes', async () => {
    asDevice()
    const request = stubPlugin()
    const { installNativeHttp } = await loadHttp()
    await installNativeHttp()

    await globalThis.fetch('https://www.jiosaavn.com/a', { headers: { Accept: 'application/json' } })
    await globalThis.fetch('https://www.jiosaavn.com/b', { headers: [['User-Agent', 'VIBEX']] })
    await globalThis.fetch('https://www.jiosaavn.com/c', { headers: new Headers({ 'X-Test': '1' }) })

    expect(request.mock.calls[0][0].headers).toMatchObject({ Accept: 'application/json' })
    expect(request.mock.calls[1][0].headers).toMatchObject({ 'User-Agent': 'VIBEX' })
    expect(request.mock.calls[2][0].headers).toMatchObject({ 'x-test': '1' })
  })

  // The home feed fires four searches at once; the wrapper must hold no shared
  // in-flight state or the second call would take the wrong branch.
  it('handles parallel jiosaavn.com requests without a shared recursion guard', async () => {
    asDevice()
    const request = stubPlugin()
    const { installNativeHttp } = await loadHttp()
    await installNativeHttp()

    await Promise.all(
      Array.from({ length: 4 }, (_, i) => globalThis.fetch(`https://www.jiosaavn.com/api.php?q=${i}`))
    )
    expect(request).toHaveBeenCalledTimes(4)
  })

  it('falls back to the WebView fetch if the native call rejects', async () => {
    asDevice()
    const request = vi.fn(async () => {
      throw new Error('bridge down')
    })
    stubPlugin(request)
    const { installNativeHttp } = await loadHttp()
    await installNativeHttp()

    const res = await globalThis.fetch('https://www.jiosaavn.com/api.php')
    expect(request).toHaveBeenCalledTimes(1)
    // The WebView fetch is the stub from beforeEach, which resolves fine.
    expect(res).toBeInstanceOf(Response)
  })
})
