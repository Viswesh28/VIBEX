import { describe, expect, it, vi } from 'vitest'
import {
  applyPlatformClasses,
  isIOS,
  isIOSSafari,
  isLocalOrigin,
  isStandalone,
  needsIOSInstallHint,
  preparePlaybackAudioSession,
  setThemeColor,
} from '../src/lib/platform.js'

/**
 * These probes decide whether the app claims to be an installed iPhone app,
 * so each one is exercised against a fake window rather than the jsdom
 * defaults — the cost of getting `isStandalone` wrong is the share-sheet hint
 * never appearing (or appearing forever).
 */
const win = (over = {}) => ({
  navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 },
  location: { hostname: 'vibex-music-pi.vercel.app' },
  matchMedia: () => ({ matches: false }),
  ...over,
})

const iphone = (over = {}) =>
  win({
    navigator: {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
    },
    ...over,
  })

describe('platform probes', () => {
  it('detects iPhone and iPadOS (which reports as a Mac)', () => {
    expect(isIOS(iphone())).toBe(true)
    expect(isIOS(win({ navigator: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', maxTouchPoints: 0 } }))).toBe(false)
    expect(
      isIOS(win({ navigator: { userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 5, platform: 'MacIntel' } }))
    ).toBe(true)
  })

  it('separates Safari from the other iOS browsers', () => {
    expect(isIOSSafari(iphone())).toBe(true)
    const crios = iphone({
      navigator: {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
        maxTouchPoints: 5,
      },
    })
    expect(isIOSSafari(crios)).toBe(false)
    expect(isIOSSafari(win())).toBe(false)
  })

  it('treats navigator.standalone and display-mode as installed', () => {
    expect(isStandalone(win({ navigator: { standalone: true } }))).toBe(true)
    expect(isStandalone(win({ matchMedia: (q) => ({ matches: q.includes('standalone') }) }))).toBe(true)
    expect(isStandalone(win())).toBe(false)
    // jsdom has no matchMedia guard failure risk; a throwing implementation
    // must not take the app down.
    expect(isStandalone(win({ matchMedia: () => { throw new Error('nope') } }))).toBe(false)
  })

  it('recognises developer origins without mistaking production for one', () => {
    expect(isLocalOrigin(win({ location: { hostname: 'localhost' } }))).toBe(true)
    expect(isLocalOrigin(win({ location: { hostname: '192.168.1.20' } }))).toBe(true)
    expect(isLocalOrigin(win({ location: { hostname: 'mac.local' } }))).toBe(true)
    expect(isLocalOrigin(win({ location: { hostname: 'vibex-music-pi.vercel.app' } }))).toBe(false)
    expect(isLocalOrigin(win({ location: { hostname: '10.1.2.3' } }))).toBe(true)
  })

  it('only asks for the install hint in a Safari tab', () => {
    expect(needsIOSInstallHint(iphone())).toBe(true)
    expect(needsIOSInstallHint(iphone({ navigator: { ...iphone().navigator, standalone: true } }))).toBe(false)
    expect(needsIOSInstallHint(win())).toBe(false)
  })

  it('asks Safari for the playback audio session when it is available', () => {
    const session = { type: 'ambient' }
    preparePlaybackAudioSession(win({ navigator: { audioSession: session } }))
    expect(session.type).toBe('playback')
    // Unsupported browsers must not throw.
    expect(() => preparePlaybackAudioSession(win())).not.toThrow()
  })
})

describe('platform side effects', () => {
  it('marks the document root so standalone-only CSS can apply', () => {
    document.documentElement.className = ''
    document.documentElement.removeAttribute('data-platform')
    applyPlatformClasses(document, iphone({ navigator: { ...iphone().navigator, standalone: true } }))
    expect(document.documentElement.classList.contains('ios')).toBe(true)
    expect(document.documentElement.classList.contains('ios-standalone')).toBe(true)
    expect(document.documentElement.classList.contains('pwa-standalone')).toBe(true)
    expect(document.documentElement.dataset.platform).toBe('ios-standalone')

    applyPlatformClasses(document, win())
    expect(document.documentElement.classList.contains('ios')).toBe(false)
    expect(document.documentElement.dataset.platform).toBe('web')
  })

  it('keeps a single theme-color meta in step with the theme', () => {
    document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove())
    setThemeColor('#09090b', document)
    setThemeColor('#f7f7f9', document)
    const tags = document.head.querySelectorAll('meta[name="theme-color"]')
    expect(tags).toHaveLength(1)
    expect(tags[0].getAttribute('content')).toBe('#f7f7f9')
  })
})
