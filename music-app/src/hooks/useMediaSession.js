import { useEffect, useRef } from 'react'
import { decodeHtml } from '../lib/format.js'
import { artistsOf, imgOf } from '../lib/song.js'
import { isIOS, preparePlaybackAudioSession } from '../lib/platform.js'
import {
  subscribeNativeMediaActions,
  syncNativeMediaMetadata,
  syncNativePlaybackState,
} from '../lib/native.js'

/**
 * Publishes active playback to BOTH the W3C Media Session API AND the native Android
 * Foreground `PlaybackService` (`MediaSession` + `Notification.MediaStyle` + WakeLock +
 * WifiLock + Bluetooth Earbuds + AudioFocus + Headphone-unplug protection).
 */
export function useMediaSession({ current, isPlaying, clock, dataSaver, actions }) {
  const lastNativeTickRef = useRef(-1)

  // --- metadata: title, artist, album and artwork for lockscreen & notification ---
  useEffect(() => {
    if (!current) {
      syncNativeMediaMetadata({
        title: '',
        artist: '',
        album: '',
        artworkUrl: '',
        durationSec: 0,
      })
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null
        try {
          navigator.mediaSession.playbackState = 'none'
        } catch {
          /* ignore */
        }
      }
      return
    }

    const title = decodeHtml(current.name)
    const artist = decodeHtml(artistsOf(current))
    const album = decodeHtml(current.album?.name || '')
    const bestArt = imgOf(current, dataSaver)

    syncNativeMediaMetadata({
      title,
      artist,
      album,
      artworkUrl: bestArt || '',
      durationSec: Number(current.duration) || 0,
    })

    if (!('mediaSession' in navigator)) return
    try {
      const artwork = (current.image || []).map((img) => {
        const m = /(\d+)x(\d+)/.exec(img.quality || img.url || '')
        return {
          src: img.url,
          sizes: m ? `${m[1]}x${m[2]}` : '500x500',
          type: 'image/jpeg',
        }
      })
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title,
        artist,
        album,
        artwork: artwork.length
          ? dataSaver
            ? artwork.slice(0, 1)
            : artwork
          : [{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
      })
    } catch {
      /* MediaMetadata unsupported */
    }
  }, [current, dataSaver])

  // --- transport state ---
  useEffect(() => {
    syncNativePlaybackState({
      isPlaying,
      positionSec: clock?.cur || 0,
      durationSec: clock?.dur || Number(current?.duration) || 0,
    })

    if (!('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
    } catch {
      /* ignore */
    }
    if (isPlaying) preparePlaybackAudioSession()
  }, [isPlaying]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- scrubber position on the lockscreen (throttled to 1 Hz on native JNI) ---
  useEffect(() => {
    const { cur, dur } = clock
    if (!dur || !isFinite(dur) || cur > dur) return

    const secBucket = Math.floor(cur)
    if (secBucket !== lastNativeTickRef.current) {
      lastNativeTickRef.current = secBucket
      syncNativePlaybackState({ isPlaying, positionSec: cur, durationSec: dur })
    }

    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
      try {
        navigator.mediaSession.setPositionState({ duration: dur, position: cur, playbackRate: 1 })
      } catch {
        /* ignore */
      }
    }
  }, [clock, isPlaying])

  // --- native Android MediaSession + Web MediaSession button/earbud handlers ---
  useEffect(() => {
    const unsubscribeNative = subscribeNativeMediaActions(actions)

    if (!('mediaSession' in navigator)) return unsubscribeNative
    const handlers = {
      play: actions.play,
      pause: actions.pause,
      previoustrack: actions.prev,
      nexttrack: actions.next,
      seekto: (d) => d?.seekTime != null && actions.seekTo(d.seekTime),
      stop: actions.pause,
    }
    if (!isIOS()) {
      handlers.seekbackward = (d) => actions.seekBy(-(d?.seekOffset || 10))
      handlers.seekforward = (d) => actions.seekBy(d?.seekOffset || 10)
    }
    const attached = []
    for (const [name, fn] of Object.entries(handlers)) {
      try {
        navigator.mediaSession.setActionHandler(name, fn)
        attached.push(name)
      } catch {
        /* unsupported action */
      }
    }
    return () => {
      unsubscribeNative()
      attached.forEach((name) => {
        try {
          navigator.mediaSession.setActionHandler(name, null)
        } catch {
          /* ignore */
        }
      })
    }
  }, [actions])
}
