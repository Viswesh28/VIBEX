import { useEffect } from 'react'
import { decodeHtml } from '../lib/format.js'
import { artistsOf } from '../lib/song.js'

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
      return
    }
    try {
      // Offer several sizes; the OS picks what fits its layout.
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
        artwork: dataSaver ? artwork.slice(0, 1) : artwork,
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
      seekbackward: (d) => actions.seekBy(-(d?.seekOffset || 10)),
      seekforward: (d) => actions.seekBy(d?.seekOffset || 10),
      seekto: (d) => d?.seekTime != null && actions.seekTo(d.seekTime),
      stop: actions.pause,
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
