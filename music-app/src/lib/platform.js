/**
 * Environment probes for the iPhone / installed-web-app experience.
 *
 * Every helper takes an optional window so it can be unit-tested without
 * editing the real navigator, and so nothing here depends on module-load
 * order (the platform must be known before the first render).
 */

const getWin = (win) => win || (typeof window !== 'undefined' ? window : null)

/** iPhone, iPod touch, or iPad — including iPadOS 13+, which reports as a Mac. */
export function isIOS(win) {
  const w = getWin(win)
  if (!w) return false
  const nav = w.navigator || {}
  const ua = nav.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1
}

/**
 * Safari proper, as opposed to Chrome/Firefox/Edge/Opera on iOS. Everyone
 * ships WebKit, but only Safari's share sheet adds a real home-screen web app,
 * and only that app gets push and background audio.
 */
export function isIOSSafari(win) {
  if (!isIOS(win)) return false
  const ua = getWin(win)?.navigator?.userAgent || ''
  return !/(CriOS|FxiOS|EdgiOS|OPiOS|GSA|DuckDuckGo)/i.test(ua)
}

/** True when launched from the home screen rather than a browser tab. */
export function isStandalone(win) {
  const w = getWin(win)
  if (!w) return false
  if (w.navigator?.standalone === true) return true
  try {
    return !!w.matchMedia?.('(display-mode: standalone)').matches
  } catch {
    return false
  }
}

/** The native shell (VIBEX Android JNI bridge or Capacitor) is not a browser tab or PWA. */
export function isNativeShell(win) {
  const w = getWin(win)
  if (!w) return false
  return Boolean(
    w.Capacitor?.isNativePlatform?.() || w.__VIBEX_NATIVE === true || w.VibexAndroid
  )
}

/**
 * A development machine or a phone hitting `npm run dev` on the LAN. Used only
 * to choose wording ("start the API" vs "check your connection"), never to
 * change behaviour.
 */
export function isLocalOrigin(win) {
  const w = getWin(win)
  if (!w) return false
  const host = w.location?.hostname || ''
  if (!host) return true
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host)) return true
  if (/\.local$/i.test(host)) return true
  return (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  )
}

/** Coarse phone detection used for copy, not layout (CSS owns layout). */
export function isPhone(win) {
  const w = getWin(win)
  if (!w) return false
  try {
    return !!w.matchMedia?.('(max-width: 640px), (orientation: landscape) and (max-height: 480px)').matches
  } catch {
    return false
  }
}

/**
 * Classes on <html> so CSS can target the installed iOS app without shipping
 * an iOS-only stylesheet. Applied before React renders to avoid a flash.
 */
export function applyPlatformClasses(doc = typeof document !== 'undefined' ? document : null, win) {
  if (!doc) return
  const w = getWin(win)
  const root = doc.documentElement
  const ios = isIOS(w)
  const standalone = isStandalone(w)
  const native = isNativeShell(w)
  const classes = {
    ios,
    'ios-standalone': ios && standalone,
    'pwa-standalone': standalone,
    'ios-safari': isIOSSafari(w),
    'vibex-native': native,
    'vibex-phone': isPhone(w),
  }
  for (const [name, on] of Object.entries(classes)) root.classList.toggle(name, !!on)
  root.dataset.platform = native ? 'native' : ios ? (standalone ? 'ios-standalone' : 'ios') : standalone ? 'pwa' : 'web'
}

/**
 * Keep the browser/OS theme colour in step with the in-app theme. On iOS 26
 * the system samples the page for the status-bar/island area, and on Android
 * Chrome this paints the toolbar.
 */
export function setThemeColor(color, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || !color) return
  let meta = doc.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = doc.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    doc.head?.appendChild(meta)
  }
  meta.setAttribute('content', color)
}

/**
 * Ask Safari for the media audio session rather than the ambient one.
 *
 * `playback` is what keeps a home-screen web app playing with the silent
 * switch on and what makes the OS treat it as a music app (lock screen,
 * Control Center, the Dynamic Island's Now Playing presentation). Unsupported
 * on older Safari and on every other browser — hence the try/catch.
 */
export function preparePlaybackAudioSession(win) {
  const w = getWin(win)
  try {
    const session = w?.navigator?.audioSession
    if (session && session.type !== 'playback') session.type = 'playback'
  } catch {
    /* not supported, or locked until playback starts */
  }
}

/** Safari-only hint: the share-sheet install flow, not a prompt() button. */
export function needsIOSInstallHint(win) {
  return isIOSSafari(win) && !isStandalone(win) && !isNativeShell(win)
}
