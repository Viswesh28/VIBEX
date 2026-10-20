// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

/**
 * The install experience is mostly configuration: a manifest, a handful of
 * Apple meta tags, launch images and a worker. None of it is exercised by
 * mounting React, and every one of these fields has a visibly broken failure
 * mode on an iPhone (generic letter icon, white splash, Safari chrome, no
 * background audio). So they are asserted against the actual files.
 */
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const read = (...p) => readFileSync(path.join(root, ...p), 'utf8')
const publicFile = (...p) => path.join(root, 'public', ...p)

describe('web app manifest', () => {
  const manifest = JSON.parse(read('public', 'manifest.webmanifest'))

  it('launches standalone from the site root', () => {
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
    expect(manifest.name).toMatch(/VIBEX/)
    // iOS "Add to Home Screen" shows short_name under the icon.
    expect(manifest.short_name).toBe('VIBEX')
  })

  it('declares both regular and maskable icons at the sizes Android needs', () => {
    const sizes = (purpose) =>
      manifest.icons.filter((i) => i.purpose === purpose).map((i) => i.sizes)
    expect(sizes('any')).toEqual(expect.arrayContaining(['192x192', '512x512']))
    expect(sizes('maskable')).toEqual(expect.arrayContaining(['192x192', '512x512']))
    for (const icon of manifest.icons) {
      expect(existsSync(publicFile(icon.src.replace(/^\//, ''))), icon.src).toBe(true)
    }
  })

  it('paints the launch background in VIBEX black, not white', () => {
    expect(manifest.background_color).toBe('#09090b')
    expect(manifest.theme_color).toBe('#09090b')
  })
})

describe('iOS document head', () => {
  const html = read('index.html')

  it('allows edge-to-edge layout around the notch and Dynamic Island', () => {
    expect(html).toMatch(/name="viewport"[^>]*viewport-fit=cover/)
  })

  it('installs as a standalone web app with a stable status bar', () => {
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"')
    expect(html).toContain('name="mobile-web-app-capable" content="yes"')
    // `black` keeps white status-bar glyphs legible in both themes; the
    // document starts below the bar so nothing hides under the island.
    expect(html).toContain('name="apple-mobile-web-app-status-bar-style" content="black"')
    expect(html).toContain('name="apple-mobile-web-app-title" content="VIBEX"')
  })

  it('links the manifest and the Apple touch icon', () => {
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"')
    expect(html).toContain('rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png"')
    expect(existsSync(publicFile('icons', 'apple-touch-icon.png'))).toBe(true)
  })

  it('ships a launch image for every current iPhone size, portrait and landscape', () => {
    const images = [...html.matchAll(/rel="apple-touch-startup-image" href="([^"]+)"/g)].map((m) => m[1])
    expect(images.length).toBeGreaterThanOrEqual(20)
    for (const src of images) {
      expect(existsSync(publicFile(src.replace(/^\//, ''))), src).toBe(true)
    }
    for (const size of ['1179x2556', '1290x2796', '1320x2868', '750x1334']) {
      expect(images).toContain(`/splash/${size}.png`)
    }
    expect(images.some((src) => src.includes('landscape') === false && src === '/splash/2796x1290.png')).toBe(true)
  })
})

describe('service worker', () => {
  const source = read('public', 'sw.js')

  it('parses as JavaScript', () => {
    expect(() => new vm.Script(source)).not.toThrow()
  })

  it('never intercepts catalogue, downloads or audio', () => {
    // A cached /api response would show yesterday's search; an intercepted
    // /dl or stream would break range requests and background audio.
    expect(source).toMatch(/const isApi\b/)
    expect(source).toContain("pathname === '/dl'")
    expect(source).toContain("pathname.startsWith('/api/')")
    expect(source).toContain("request.headers.has('range')")
    expect(source).toContain('url.origin !== self.location.origin')
  })

  it('serves navigation network-first and falls back to the cached shell', () => {
    expect(source).toContain('fetchWithTimeout(request, NAV_TIMEOUT_MS)')
    expect(source).toContain("await shell.match('/')")
    expect(source).toContain("await shell.match('/offline.html')")
  })

  it('activates a new worker without stranding open clients', () => {
    expect(source).toContain('self.skipWaiting()')
    expect(source).toContain('self.clients.claim()')
    expect(source).toContain("key.startsWith('vibex-')")
  })
})
