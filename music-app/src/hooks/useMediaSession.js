import { useEffect } from 'react'
import { decodeHtml } from '../lib/format.js'
import { artistsOf } from '../lib/song.js'
import { isIOS, preparePlaybackAudioSession } from '../lib/platform.js'

/**
 * Publishes the current track to the OS media session, which is what draws the
 * lockscreen / notification-shade player on Android and the Control Center
 * widget on iOS. Without this a WebView-hosted player has no controls once the
 * screen is off — the single most important thing to get right on mobile.
 *
 * No-ops where the API is unavailable (older browsers, some WebViews).
 */
export function useMediaSession({ current, isPlaying, clock, dataSaver, actions }) {
  // --- metadata: title, artist, album and artwork for the lockscreen ---
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!current) {
      navigator.mediaSession.metadata = null
      try {
        navigator.mediaSession.playbackState = 'none'
      } catch {
        /* ignore */
      }
      return
    }
    try {
      // Offer several sizes; the OS picks what fits its layout (the lock
      // screen, Control Center, and the Dynamic Island's Now Playing view all
      // ask for different ones).
      const artwork = (current.image || []).map((img) => {
        const m = /(\d+)x(\d+)/.exec(img.quality || img.url || '')
        return {
          src: img.url,
          sizes: m ? `${m[1]}x${m[2]}` : '500x500',
          type: 'image/jpeg',
        }
      })
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: decodeHtml(current.name),
        artist: decodeHtml(artistsOf(current)),
        album: decodeHtml(current.album?.name || ''),
        // A track with no artwork must still show something: iOS draws an
        // empty grey square otherwise.
        artwork: artwork.length
          ? dataSaver
            ? artwork.slice(0, 1)
            : artwork
          : [{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
      })
    } catch {
      /* MediaMetadata unsupported — controls simply won't appear */
    }
  }, [current, dataSaver])

  // --- transport state ---
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
    } catch {
      /* ignore */
    }
    // Safari only keeps the playback audio session (silent switch ignored,
    // background playback, Now Playing on the island) while media is live.
    if (isPlaying) preparePlaybackAudioSession()
  }, [isPlaying])

  // --- scrubber position on the lockscreen ---
  useEffect(() => {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return
    const { cur, dur } = clock
    if (!dur || !isFinite(dur) || cur > dur) return
    try {
      navigator.mediaSession.setPositionState({ duration: dur, position: cur, playbackRate: 1 })
    } catch {
      /* ignore */
    }
  }, [clock])

  // --- hardware / notification buttons ---
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const handlers = {
      play: actions.play,
      pause: actions.pause,
      previoustrack: actions.prev,
      nexttrack: actions.next,
      seekto: (d) => d?.seekTime != null && actions.seekTo(d.seekTime),
      stop: actions.pause,
    }
    // iOS only keeps previous/next on the lock screen while those are the
    // scrubber actions. Registering ±10s replaces them, which is a worse
    // trade on a music player — so the skip buttons are omitted there.
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
        /* this action isn't supported here */
      }
    }
    return () => {
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
