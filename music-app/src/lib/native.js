/**
 * Unified native platform bridge for Android (`window.VibexAndroid` JNI bridge +
 * Capacitor plugins when present). Every helper safely no-ops in standard web browsers.
 */
import { hasAndroidBridge, isNative } from './config.js'

let appMod = null
let coreMod = null

async function loadApp() {
  if (!appMod) appMod = await import('@capacitor/app')
  return appMod
}

async function loadCore() {
  if (!coreMod) coreMod = await import('@capacitor/core')
  return coreMod
}

function getAndroidBridge() {
  return typeof window !== 'undefined' ? window.VibexAndroid || null : null
}

/**
 * Register a hardware / predictive-gesture Android back handler.
 * When `handler()` returns `false` (already at root view with no open sheet/drawer),
 * calls `minimizeApp()` (`Activity.moveTaskToBack(true)`) so music continues playing
 * cleanly in the background instead of destroying the Activity.
 */
export async function onBackButton(handler) {
  const disposers = []

  if (hasAndroidBridge() && typeof window !== 'undefined') {
    const onNativeBack = async (ev) => {
      ev?.preventDefault?.()
      let consumed = false
      try {
        consumed = Boolean(await handler())
      } catch {
        consumed = false
      }
      if (!consumed) {
        try {
          getAndroidBridge()?.minimizeApp?.()
        } catch {
          /* ignore */
        }
      }
    }
    window.addEventListener('vibex:native-back', onNativeBack)
    disposers.push(() => window.removeEventListener('vibex:native-back', onNativeBack))
  }

  if (isNative()) {
    try {
      const { App } = await loadApp()
      const sub = await App.addListener('backButton', async () => {
        const consumed = await handler()
        if (!consumed) App.minimizeApp()
      })
      disposers.push(() => sub.remove())
    } catch {
      /* ignore */
    }
  }

  return () => {
    disposers.forEach((fn) => {
      try {
        fn()
      } catch {
        /* ignore */
      }
    })
  }
}

/**
 * Subscribe to native Android Share Sheet intents (`ACTION_SEND` `text/plain`)
 * and App-Link deep links (`ACTION_VIEW` `https://vibex-music-pi.vercel.app/...`
 * or `vibex://...`), both on cold launch and warm `onNewIntent` resume.
 */
export async function subscribeNativeShare(onPayload) {
  if (typeof onPayload !== 'function') return () => {}
  const subs = []

  if (hasAndroidBridge() && typeof window !== 'undefined') {
    const onShareEvent = (ev) => {
      const data = ev?.detail
      if (data && (data.url || data.text || data.title)) {
        onPayload({
          url: data.url || '',
          text: data.text || '',
          title: data.title || '',
        })
      }
    }
    window.addEventListener('vibex:native-share', onShareEvent)
    subs.push({ remove: () => window.removeEventListener('vibex:native-share', onShareEvent) })

    try {
      const raw = getAndroidBridge()?.consumeInitialShare?.()
      if (raw) {
        const initial = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (initial && (initial.url || initial.text || initial.title)) {
          onPayload({
            url: initial.url || '',
            text: initial.text || '',
            title: initial.title || '',
          })
        }
      }
    } catch {
      /* ignore malformed initial payload */
    }
  }

  if (isNative()) {
    try {
      const { App } = await loadApp()
      const urlSub = await App.addListener('appUrlOpen', (event) => {
        if (event?.url) onPayload({ url: event.url, text: '', title: '' })
      })
      subs.push(urlSub)
    } catch {
      /* ignore */
    }
    try {
      const { registerPlugin } = await loadCore()
      const ShareIntent = registerPlugin('ShareIntent')
      const shareSub = await ShareIntent.addListener('shareReceived', (data) => {
        if (data && (data.url || data.text || data.title)) {
          onPayload({
            url: data.url || '',
            text: data.text || '',
            title: data.title || '',
          })
        }
      })
      subs.push(shareSub)
      const initial = await ShareIntent.getInitialShare?.().catch(() => null)
      if (initial && (initial.url || initial.text || initial.title)) {
        onPayload({
          url: initial.url || '',
          text: initial.text || '',
          title: initial.title || '',
        })
      }
    } catch {
      /* ignore */
    }
  }

  return () => {
    subs.forEach((s) => {
      try {
        s?.remove?.()
      } catch {
        /* ignore */
      }
    })
  }
}

/**
 * Push active track metadata + artwork URL into Android's foreground `PlaybackService`
 * so the system notification shade, lock screen, Bluetooth head unit, and smartwatches
 * display full artwork, title, artist, album, and duration.
 */
export function syncNativeMediaMetadata({
  title = '',
  artist = '',
  album = '',
  artworkUrl = '',
  durationSec = 0,
} = {}) {
  const bridge = getAndroidBridge()
  if (!bridge?.updateMetadata) return
  try {
    const durationMs =
      Number.isFinite(durationSec) && durationSec > 0 ? Math.round(durationSec * 1000) : 0
    bridge.updateMetadata(
      String(title || ''),
      String(artist || ''),
      String(album || ''),
      String(artworkUrl || ''),
      durationMs
    )
  } catch {
    /* ignore */
  }
}

/**
 * Push active play/pause state + current seek position into Android's `MediaSession`
 * and acquire/release `PARTIAL_WAKE_LOCK` + `WifiLock` for screen-off streaming.
 */
export function syncNativePlaybackState({
  isPlaying = false,
  positionSec = 0,
  durationSec = 0,
} = {}) {
  const bridge = getAndroidBridge()
  if (!bridge?.updatePlaybackState) return
  try {
    const posMs = Number.isFinite(positionSec) && positionSec >= 0 ? Math.round(positionSec * 1000) : 0
    const durMs = Number.isFinite(durationSec) && durationSec > 0 ? Math.round(durationSec * 1000) : 0
    bridge.updatePlaybackState(Boolean(isPlaying), posMs, durMs)
  } catch {
    /* ignore */
  }
}

/**
 * Subscribe to transport commands emitted by Android's `PlaybackService`
 * (Lock Screen buttons, Notification buttons, Bluetooth Earbuds, Android Auto,
 * phone call `AudioFocus` pause/duck, and headphone unplug `ACTION_AUDIO_BECOMING_NOISY`).
 */
export function subscribeNativeMediaActions(actions) {
  if (typeof window === 'undefined' || !actions) return () => {}
  const onAction = (ev) => {
    const d = ev?.detail || {}
    switch (d.action) {
      case 'play':
        actions.play?.()
        break
      case 'pause':
      case 'stop':
        actions.pause?.()
        break
      case 'toggle':
        actions.toggle?.()
        break
      case 'next':
        actions.next?.()
        break
      case 'prev':
        actions.prev?.()
        break
      case 'seekto':
        if (typeof d.positionMs === 'number' && Number.isFinite(d.positionMs)) {
          actions.seekTo?.(Math.max(0, d.positionMs / 1000))
        }
        break
      case 'seekby':
        if (typeof d.offsetMs === 'number' && Number.isFinite(d.offsetMs)) {
          actions.seekBy?.(d.offsetMs / 1000)
        }
        break
      case 'duck':
        actions.setDucking?.(true)
        break
      case 'unduck':
        actions.setDucking?.(false)
        break
      default:
        break
    }
  }
  window.addEventListener('vibex:native-media-action', onAction)
  return () => window.removeEventListener('vibex:native-media-action', onAction)
}

/** Trigger runtime `POST_NOTIFICATIONS` permission dialog on Android 13+ (API 33+). */
export function requestNativeNotificationPermission() {
  try {
    getAndroidBridge()?.requestNotificationPermission?.()
  } catch {
    /* ignore */
  }
}
