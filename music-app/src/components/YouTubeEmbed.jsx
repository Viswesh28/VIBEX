import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { decodeHtml } from '../lib/format.js'
import { embedErrorCopy, embedUrl } from '../lib/ytEmbed.js'
import { Icon } from './Icon.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'

/**
 * YouTube's official IFrame player surface for unmatched YouTube items (e.g.
 * mixes, concerts, covers, or tracks without a studio audio counterpart).
 *
 * Docked compactly above VIBEX's bottom player bar by default (never blocking
 * browsing or the main player controls) and synced bidirectionally over
 * YouTube's official `enablejsapi=1` `postMessage` channel (`onReady`,
 * `onStateChange`, `infoDelivery`, `onError`, plus `playVideo`, `pauseVideo`,
 * `seekTo`, and `setVolume`).
 */
export function YouTubeEmbed() {
  const {
    embedTrack,
    closeEmbed,
    reportEmbed,
    registerEmbedCommand,
    volume,
  } = usePlayer()
  const open = Boolean(embedTrack)
  const frame = useRef(null)
  const volRef = useRef(volume)
  const [failure, setFailure] = useState('')

  useEffect(() => {
    volRef.current = volume
  }, [volume])

  const src = useMemo(() => {
    if (!embedTrack) return null
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return embedUrl({ videoId: embedTrack.videoId }, { origin, autoplay: true })
  }, [embedTrack])

  /** One command to YouTube's player, over the same channel as the handshake. */
  const command = useCallback((func, args) => {
    frame.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args: args || [], id: 1, channel: 'vibex' }),
      '*'
    )
  }, [])

  useEffect(() => {
    if (!open || !registerEmbedCommand) return undefined
    return registerEmbedCommand(command)
  }, [open, registerEmbedCommand, command])

  const onKey = useCallback(
    (e) => {
      if (e.key === 'Escape') closeEmbed()
    },
    [closeEmbed]
  )

  useEffect(() => {
    if (!open) return undefined
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onKey])

  // A new video starts with a clean slate; a stale failure would blame it.
  useEffect(() => {
    setFailure('')
  }, [src])

  /**
   * Official YouTube IFrame JS API handshake (`listening` + `infoDelivery` +
   * `onStateChange` + `onError`).
   */
  useEffect(() => {
    if (!open || !src) return undefined

    const handleStateCode = (code) => {
      if (code === 1) reportEmbed('playing')
      else if (code === 2) reportEmbed('paused')
      else if (code === 3) reportEmbed('buffering')
      else if (code === 0) {
        if (reportEmbed('ended') === 'replay') {
          command('seekTo', [0, true])
          command('playVideo')
        }
      }
    }

    const onMessage = (event) => {
      if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(String(event.origin))) return
      const frameWindow = frame.current?.contentWindow
      if (frameWindow && event.source !== frameWindow) return
      let data
      try {
        data = JSON.parse(event.data)
      } catch {
        return
      }
      if (data?.event === 'onError') {
        setFailure(embedErrorCopy(data.info))
        reportEmbed('error', data.info)
      }
      if (data?.event === 'onReady') {
        setFailure('')
        if (Number.isFinite(volRef.current)) {
          command('setVolume', [Math.round(volRef.current * 100)])
        }
      }
      if (data?.event === 'onStateChange') {
        handleStateCode(Number(data.info))
      }
      if (data?.event === 'infoDelivery' && data.info && typeof data.info === 'object') {
        const cur = Number(data.info.currentTime)
        const dur = Number(data.info.duration)
        if (Number.isFinite(cur) || (Number.isFinite(dur) && dur > 0)) {
          reportEmbed('progress', { cur, dur })
        }
        if (typeof data.info.playerState === 'number') {
          handleStateCode(data.info.playerState)
        }
      }
    }

    window.addEventListener('message', onMessage)
    const hello = () => {
      const win = frame.current?.contentWindow
      if (!win) return
      win.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'vibex' }), '*')
      win.postMessage(
        JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onReady'], id: 1, channel: 'vibex' }),
        '*'
      )
      win.postMessage(
        JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'], id: 1, channel: 'vibex' }),
        '*'
      )
      win.postMessage(
        JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onError'], id: 1, channel: 'vibex' }),
        '*'
      )
    }
    hello()
    const beat = setInterval(hello, 1200)
    const stop = setTimeout(() => clearInterval(beat), 9600)

    return () => {
      clearInterval(beat)
      clearTimeout(stop)
      window.removeEventListener('message', onMessage)
    }
  }, [open, src, reportEmbed, command])

  if (!open || !src) return null

  const title = decodeHtml(embedTrack.name || 'YouTube video')
  const artist = embedTrack.subtitle ? decodeHtml(embedTrack.subtitle) : ''
  const watchUrl = `https://www.youtube.com/watch?v=${embedTrack.videoId}`

  return (
    <div
      id="ytEmbed"
      className={failure ? 'has-error' : 'is-audio-only'}
      role="region"
      aria-label="YouTube audio transport"
    >
      <div id="ytEmbedHead">
        <div id="ytEmbedMeta">
          <Icon name="music" size={15} />
          <b>{title}</b>
          {artist && <span>{artist}</span>}
        </div>
        <button
          type="button"
          id="ytEmbedClose"
          title="Close (Esc)"
          aria-label="Close YouTube player"
          onClick={closeEmbed}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div id="ytEmbedStage">
        <iframe
          id="ytEmbedFrame"
          ref={frame}
          src={src}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      {failure ? (
        <p id="ytEmbedError" role="alert">
          {failure}{' '}
          <a href={watchUrl} target="_blank" rel="noreferrer">
            Open on YouTube
          </a>
        </p>
      ) : (
        <p id="ytEmbedNote">
          Audio-only playback active in player bar.
        </p>
      )}
    </div>
  )
}
