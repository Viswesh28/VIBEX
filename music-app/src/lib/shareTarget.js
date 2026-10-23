/**
 * Cross-Device "Share to VIBEX" Engine (`shareTarget.js`).
 *
 * Normalizes messy real-world share payloads coming from:
 *  1. Installed Web PWA OS Share Sheet (`manifest.webmanifest` -> `share_target`)
 *  2. Window Launch Queue (`window.launchQueue` with `focus-existing` — zero reload!)
 *  3. Native Android APK Intent (`ACTION_SEND` `text/plain` & `vibex://share`)
 *  4. iOS / iPadOS Shortcuts (`/?share_url=...`), Safari Clipboard & Bookmarklets
 *  5. Direct Paste / Search-Bar Smart Link Detection (`Ctrl+V` / `Cmd+V` or `#searchInput`)
 */

import { isIOS, isIOSSafari, isNativeShell, isStandalone } from './platform.js'

const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'`]+/gi
const SPOTIFY_URI_RE = /\bspotify:(track|album|playlist|artist):([A-Za-z0-9]{15,32})\b/i
const YT_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/

const SHARE_QUERY_KEYS = [
  'vibex_share',
  'share_url',
  'share_text',
  'share_title',
  'shared_url',
]

/** Strip trailing punctuation appended by mobile chat/social share templates. */
export function cleanExtractedUrl(raw = '') {
  return String(raw || '')
    .trim()
    .replace(/^[([<"'“‘]+/, '')
    .replace(/[)\].,!?;:>"'”’]+$/, '')
}

/** Extract the best candidate URL (or `spotify:...` URI converted to HTTPS) from text. */
export function extractFirstUrl(raw = '') {
  const text = String(raw || '').trim()
  if (!text) return ''

  // Handle `web+vibex://...` or `vibex://share?url=...`
  if (/^(?:web\+)?vibex:/i.test(text)) {
    try {
      const stripped = text.replace(/^web\+vibex:\/\//i, '').replace(/^web\+vibex:/i, '')
      if (/^https?%3A/i.test(stripped)) {
        return cleanExtractedUrl(decodeURIComponent(stripped))
      }
      if (/^https?:\/\//i.test(stripped)) {
        return cleanExtractedUrl(stripped)
      }
      const u = new URL(text.replace(/^web\+/, ''))
      const inner = u.searchParams.get('url') || u.searchParams.get('text') || ''
      if (inner) return extractFirstUrl(inner) || cleanExtractedUrl(inner)
    } catch {
      /* continue */
    }
  }

  const spotifyUri = SPOTIFY_URI_RE.exec(text)
  if (spotifyUri) {
    return `https://open.spotify.com/${spotifyUri[1].toLowerCase()}/${spotifyUri[2]}`
  }

  const matches = text.match(URL_IN_TEXT_RE)
  if (!matches || !matches.length) return ''

  const cleaned = matches.map(cleanExtractedUrl).filter(Boolean)
  // Prefer known music domains if multiple URLs exist in the shared message.
  const preferred = cleaned.find((u) => isSupportedMusicUrl(u))
  return preferred || cleaned[0] || ''
}

/** Parse `?t=95`, `?t=1m35s`, `?start=42`, `#t=88` into integer seconds. */
export function parseTimestampSeconds(urlObj) {
  if (!urlObj) return 0
  const raw =
    urlObj.searchParams.get('t') ||
    urlObj.searchParams.get('start') ||
    (/^#t=(.+)$/i.exec(urlObj.hash || '')?.[1] ?? '')
  if (!raw) return 0
  if (/^\d+$/.test(raw)) return Math.max(0, Number(raw))
  const hms = /(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?/i.exec(raw)
  if (!hms) return 0
  const h = Number(hms[1] || 0)
  const m = Number(hms[2] || 0)
  const s = Number(hms[3] || 0)
  return Math.max(0, h * 3600 + m * 60 + s)
}

/** Clean noisy mobile share prose (`"Here’s a song for you… X by Y"`, Shazam, etc.). */
export function cleanShareTextQuery({ title = '', text = '' } = {}) {
  const combined = [String(title || '').trim(), String(text || '').trim()]
    .filter(Boolean)
    .join(' — ')
  return combined
    .replace(URL_IN_TEXT_RE, ' ')
    .replace(SPOTIFY_URI_RE, ' ')
    .replace(/\b(?:here['’]s a (?:song|playlist|album) for you|listen to|check out|i used shazam to discover|on spotify|on jiosaavn|on youtube music|on youtube|on apple music|from shazam)\b/gi, ' ')
    .replace(/[|•·…]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
}

/** True when `raw` contains a recognized external music URL or Spotify URI. */
export function isSupportedMusicUrl(raw = '') {
  const s = String(raw || '').trim()
  if (!s) return false
  if (SPOTIFY_URI_RE.test(s) || /^(?:web\+)?vibex:/i.test(s)) return true
  const candidate = /^https?:\/\//i.test(s) ? cleanExtractedUrl(s) : extractFirstUrl(s)
  if (!candidate) return false
  try {
    const u = new URL(candidate)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    return (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtu.be' ||
      host === 'youtube-nocookie.com' ||
      host === 'open.spotify.com' ||
      host === 'play.spotify.com' ||
      host === 'spotify.com' ||
      host === 'spotify.link' ||
      host === 'spoti.fi' ||
      host === 'jiosaavn.com' ||
      host === 'saavn.com' ||
      host === 'music.apple.com'
    )
  } catch {
    return false
  }
}

/**
 * Classify any cross-app share payload `{ url, text, title }` into a structured intent:
 *  - `kind: 'track'`      -> Single song/video ready for immediate playback
 *  - `kind: 'collection'` -> Playlist / Album / Artist top tracks to play or import
 *  - `kind: 'vibex'`      -> Native VIBEX deep link (`?play=...`, `/artist/...`, etc.)
 *  - `kind: 'query'`      -> Plain text song title / artist from Shazam, WhatsApp, etc.
 */
export function parseSharedInput({ url = '', text = '', title = '' } = {}) {
  const rawUrl =
    extractFirstUrl(url) ||
    extractFirstUrl(text) ||
    extractFirstUrl(title) ||
    ''

  const hintTitle = cleanShareTextQuery({ title, text })

  if (rawUrl) {
    try {
      const u = new URL(rawUrl)
      const host = u.hostname.toLowerCase().replace(/^www\./, '')
      const path = u.pathname || '/'
      const seekSec = parseTimestampSeconds(u)

      // 1. YouTube & YouTube Music
      // IMPORTANT: Single tracks shared from YT Music look like
      // `music.youtube.com/watch?v=VIDEO_ID&list=RDAMVM...` — `v=` MUST win over `&list=RDAMVM...`!
      if (
        host === 'youtu.be' ||
        host === 'youtube.com' ||
        host === 'm.youtube.com' ||
        host === 'music.youtube.com' ||
        host === 'youtube-nocookie.com'
      ) {
        let videoId = ''
        if (host === 'youtu.be') {
          videoId = path.split('/').filter(Boolean)[0] || ''
        } else if (path === '/watch') {
          videoId = u.searchParams.get('v') || ''
        } else {
          const segMatch = /^\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/i.exec(path)
          if (segMatch) videoId = segMatch[1]
        }

        const browseMatch = /^\/browse\/(MPREb_[A-Za-z0-9_-]+|VL[A-Za-z0-9_-]+)/i.exec(path)
        const listParam = u.searchParams.get('list') || ''

        if (YT_VIDEO_ID_RE.test(videoId) && path !== '/playlist') {
          return {
            kind: 'track',
            provider: 'youtube',
            providerLabel: host === 'music.youtube.com' ? 'YouTube Music' : 'YouTube',
            videoId,
            url: `https://music.youtube.com/watch?v=${videoId}`,
            originalUrl: rawUrl,
            seekSec,
            hintTitle,
          }
        }

        if (browseMatch || listParam) {
          const listId = browseMatch ? browseMatch[1] : listParam
          const isAlbum = /^MPREb_|^OLAK5uy_/i.test(listId)
          return {
            kind: 'collection',
            subKind: isAlbum ? 'album' : 'playlist',
            provider: 'youtube',
            providerLabel: host === 'music.youtube.com' ? 'YouTube Music' : 'YouTube',
            listId,
            url: rawUrl,
            originalUrl: rawUrl,
            seekSec: 0,
            hintTitle,
          }
        }
      }

      // 2. Spotify (`open.spotify.com`, `/intl-en/track/...`, `/embed/...`, `spotify.link`, `spoti.fi`)
      if (host === 'spotify.link' || host === 'spoti.fi') {
        return {
          kind: 'redirect',
          provider: 'spotify',
          providerLabel: 'Spotify',
          url: rawUrl,
          originalUrl: rawUrl,
          seekSec: 0,
          hintTitle,
        }
      }

      if (host === 'open.spotify.com' || host === 'play.spotify.com' || host === 'spotify.com') {
        const spMatch =
          /\/(?:intl-[a-z-]+|embed|user\/[^/]+)?\/?(track|album|playlist|artist)\/([A-Za-z0-9]{15,32})/i.exec(
            path
          )
        if (spMatch) {
          const entityType = spMatch[1].toLowerCase()
          const spotifyId = spMatch[2]
          return {
            kind: entityType === 'track' ? 'track' : 'collection',
            subKind: entityType,
            provider: 'spotify',
            providerLabel: 'Spotify',
            spotifyId,
            url: `https://open.spotify.com/${entityType}/${spotifyId}`,
            originalUrl: rawUrl,
            seekSec,
            hintTitle,
          }
        }
      }

      // 3. JioSaavn (`jiosaavn.com` / `saavn.com`)
      if (host === 'jiosaavn.com' || host === 'saavn.com') {
        const isSong = /\/song\//i.test(path)
        const isAlbum = /\/album\//i.test(path)
        const isArtist = /\/artist\//i.test(path)
        return {
          kind: isSong ? 'track' : 'collection',
          subKind: isSong ? 'track' : isAlbum ? 'album' : isArtist ? 'artist' : 'playlist',
          provider: 'jiosaavn',
          providerLabel: 'JioSaavn',
          url: rawUrl,
          originalUrl: rawUrl,
          seekSec,
          hintTitle,
        }
      }

      // 4. Apple Music (`music.apple.com/.../album/...?i=<songId>` or `/playlist/...`)
      if (host === 'music.apple.com') {
        const hasSongParam = Boolean(u.searchParams.get('i')) || /\/song\//i.test(path)
        return {
          kind: hasSongParam ? 'track' : 'collection',
          subKind: hasSongParam ? 'track' : /\/playlist\//i.test(path) ? 'playlist' : 'album',
          provider: 'apple',
          providerLabel: 'Apple Music',
          url: rawUrl,
          originalUrl: rawUrl,
          seekSec: 0,
          hintTitle,
        }
      }

      // 5. Same-origin / VIBEX link (`?play=...`, `?v=...`)
      if (u.searchParams.get('play') || u.searchParams.get('v')) {
        return {
          kind: 'vibex',
          provider: 'vibex',
          providerLabel: 'VIBEX',
          playId: u.searchParams.get('play') || null,
          url: rawUrl,
          originalUrl: rawUrl,
          seekSec,
          hintTitle,
        }
      }
    } catch {
      /* fall through to text query */
    }
  }

  if (hintTitle) {
    return {
      kind: 'query',
      provider: 'text',
      providerLabel: 'Shared Song',
      query: hintTitle,
      url: rawUrl || '',
      originalUrl: rawUrl || '',
      seekSec: 0,
      hintTitle,
    }
  }

  return null
}

/** Extract any incoming share payload from a browser `Location` (`manifest.webmanifest` GET target). */
export function readIncomingShareFromLocation(
  loc = typeof window !== 'undefined' ? window.location : null
) {
  if (!loc) return null
  try {
    const p = new URLSearchParams(loc.search || '')
    if (p.get('v') === 'share-in') {
      return { openLauncherOnly: true }
    }
    const shareUrl = p.get('share_url') || p.get('shared_url') || ''
    const shareText = p.get('share_text') || ''
    const shareTitle = p.get('share_title') || ''
    const explicitFlag = p.get('vibex_share') === '1'
    if (!explicitFlag && !shareUrl && !shareText && !shareTitle) return null

    const parsed = parseSharedInput({
      url: shareUrl,
      text: shareText,
      title: shareTitle,
    })
    if (!parsed) return explicitFlag ? { openLauncherOnly: true } : null
    return { openLauncherOnly: false, parsed }
  } catch {
    return null
  }
}

/** Remove transient `?vibex_share=1&share_url=...` params after consuming so reload won't replay them. */
export function stripConsumedShareParams(win = typeof window !== 'undefined' ? window : null) {
  if (!win?.history?.replaceState || !win.location) return
  try {
    const u = new URL(win.location.href)
    let touched = false
    for (const key of SHARE_QUERY_KEYS) {
      if (u.searchParams.has(key)) {
        u.searchParams.delete(key)
        touched = true
      }
    }
    if (u.searchParams.get('v') === 'share-in') {
      u.searchParams.delete('v')
      touched = true
    }
    if (touched) {
      const next = u.pathname + (u.searchParams.toString() ? `?${u.searchParams.toString()}` : '') + u.hash
      win.history.replaceState(win.history.state, '', next)
    }
  } catch {
    /* ignore */
  }
}

/**
 * Subscribe to the W3C Launch Handler API (`window.launchQueue`) so sharing into an
 * already-open installed PWA delivers `{ targetURL }` live WITHOUT reloading or
 * interrupting active audio playback.
 */
export function subscribeLaunchQueueShare(
  onSharePayload,
  win = typeof window !== 'undefined' ? window : null
) {
  if (!win?.launchQueue?.setConsumer || typeof onSharePayload !== 'function') {
    return () => {}
  }
  let active = true
  try {
    win.launchQueue.setConsumer((launchParams) => {
      if (!active || !launchParams?.targetURL) return
      try {
        const targetLoc = new URL(launchParams.targetURL)
        const hit = readIncomingShareFromLocation(targetLoc)
        if (hit) onSharePayload(hit)
      } catch {
        /* ignore malformed launch URL */
      }
    })
  } catch {
    /* unsupported browser build */
  }
  return () => {
    active = false
  }
}

/**
 * Inspect cross-device Share-to-VIBEX capabilities on the user's current device
 * so the UI gives honest, accurate, actionable guidance on Android, iOS, macOS,
 * Windows, ChromeOS, Linux, Safari, Firefox, and the native Android APK.
 */
export function inspectCrossDeviceShareSupport(
  win = typeof window !== 'undefined' ? window : null
) {
  const origin = win?.location?.origin || 'https://vibex-music-pi.vercel.app'
  const ua = win?.navigator?.userAgent || ''
  const native = isNativeShell(win)
  const ios = isIOS(win)
  const iosSafari = isIOSSafari(win)
  const standalone = isStandalone(win)
  const isAndroid = /Android/i.test(ua)
  const isChromium = /Chrome|CriOS|Edg|OPR|SamsungBrowser|Brave/i.test(ua) && !ios
  const launchQueueSupported = Boolean(win && 'launchQueue' in win)
  const clipboardSupported = Boolean(win?.navigator?.clipboard?.readText)

  const iosShortcutBaseUrl = `${origin}/?share_url=`
  const bookmarkletHref = `javascript:void(window.open('${origin}/?share_url='+encodeURIComponent(location.href),'_blank'))`

  let tier = 'browser'
  let headline = 'Paste, Ctrl+V, or Install PWA for Direct Share'
  let detail =
    'Paste any YouTube, YT Music, Spotify, or JioSaavn link anywhere in VIBEX (Ctrl+V / Cmd+V), or install VIBEX to integrate with your OS.'

  if (native) {
    tier = 'native-android'
    headline = 'Active in Android System Share Sheet'
    detail =
      'VIBEX is registered natively on Android. Tap Share in YouTube, YT Music, Spotify, or JioSaavn and pick VIBEX to play or import instantly.'
  } else if (isAndroid && standalone) {
    tier = 'pwa-android-ready'
    headline = 'Active in Your Phone’s Share Sheet'
    detail =
      'Installed PWA detected — open YouTube, YT Music, Spotify, or JioSaavn, tap Share, and select VIBEX.'
  } else if (isAndroid && isChromium) {
    tier = 'pwa-android-installable'
    headline = 'Install VIBEX to Appear in Android Share Sheet'
    detail =
      'Android registers Web Share Targets when installed to your Home Screen. Install once below, or paste/read clipboard immediately right now.'
  } else if (ios) {
    tier = 'ios'
    headline = 'iPhone & iPad Share Sheet + 1-Tap Clipboard'
    detail = iosSafari
      ? 'iOS WebKit uses Apple Shortcuts for system Share Sheet handoff — tap “Paste from Clipboard” below for 1-tap playback right now, or add the 20-second “Share to VIBEX” iOS Shortcut below.'
      : 'Tap “Paste from Clipboard” below for instant playback, or add VIBEX via Safari + Apple Shortcuts to appear in the iPhone/iPad Share Sheet.'
  } else if (isChromium && standalone) {
    tier = 'pwa-desktop-ready'
    headline = 'Installed Desktop App Ready (LaunchQueue Zero-Reload)'
    detail =
      'Shared links open inside this running VIBEX window without interrupting playback. You can also press Ctrl+V / Cmd+V anywhere.'
  }

  return {
    tier,
    origin,
    native,
    ios,
    isAndroid,
    isChromium,
    standalone,
    launchQueueSupported,
    clipboardSupported,
    autoplayMayRequireTap: ios,
    headline,
    detail,
    iosShortcutBaseUrl,
    bookmarkletHref,
  }
}
