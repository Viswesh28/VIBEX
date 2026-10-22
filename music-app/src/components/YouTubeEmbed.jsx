import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { decodeHtml } from '../lib/format.js'
import { embedErrorCopy, embedUrl } from '../lib/ytEmbed.js'
import { Icon } from './Icon.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'

/**
 * YouTube's own player, for every YouTube item.
 *
 * The embed is a black box we deliberately do not drive, but it is not a silent
 * one: with `enablejsapi=1` and a matching `origin`, YouTube posts onReady,
 * onStateChange and onError to this window. onError is the only way a parent
 * can learn that the rights holder disabled embedding — the frame is
 * cross-origin and unreadable — and 101/150 is common enough on catalogue
 * items that pretending otherwise meant showing a black rectangle and blaming
 * nothing. It is surfaced now, with the way out attached.
 */
export function YouTubeEmbed() {
  const { embedTrack, closeEmbed, reportEmbed, nextTrack, prevTrack } = usePlayer()
  const open = Boolean(embedTrack)
  const frame = useRef(null)
  const [failure, setFailure] = useState('')

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
   * The JS API handshake, and the only channel that carries a refusal.
   *
   * The URL already opts in (`enablejsapi`, `origin`); what is missing is one
   * message *to* the frame. It is repeated for a few seconds because the frame
   * may not be listening yet when it first loads, and stopped afterwards so a
   * closed player does not keep pinging YouTube.
   */
  useEffect(() => {
    if (!open || !src) return undefined

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
      if (data?.event === 'onError') setFailure(embedErrorCopy(data.info))
      if (data?.event === 'onReady') setFailure('')
      if (data?.event === 'onStateChange') {
        // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued.
        const code = Number(data.info)
        if (code === 1) reportEmbed('playing')
        if (code === 2) reportEmbed('paused')
        if (code === 0) {
          if (reportEmbed('ended') === 'replay') {
            command('seekTo', [0, true])
            command('playVideo')
          }
        }
      }
    }

    window.addEventListener('message', onMessage)
    const hello = () =>
      frame.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: 1, channel: 'vibex' }),
        '*'
      )
    hello()
    const beat = setInterval(hello, 1200)
    const stop = setTimeout(() => clearInterval(beat), 9600)

    return () => {
      clearInterval(beat)
      clearTimeout(stop)
      window.removeEventListener('message', onMessage)
    }
  }, [open, src, reportEmbed])

  if (!open || !src) return null

  const title = decodeHtml(embedTrack.name || 'YouTube video')
  const artist = embedTrack.subtitle ? decodeHtml(embedTrack.subtitle) : ''
  const watchUrl = `https://www.youtube.com/watch?v=${embedTrack.videoId}`

  return (
    <div id="ytEmbed" role="dialog" aria-modal="true" aria-label="YouTube player">
      <div id="ytEmbedHead">
        <div id="ytEmbedMeta">
          <Icon name="music" size={16} />
          <b>{title}</b>
          {artist && <span>{artist}</span>}
        </div>
        <div id="ytEmbedNav">
          <button
            type="button"
            title="Previous"
            aria-label="Previous track"
            onClick={() => {
              closeEmbed()
              prevTrack()
            }}
          >
            <Icon name="chevronLeft" size={18} />
          </button>
          <button
            type="button"
            title="Next"
            aria-label="Next track"
            onClick={() => {
              closeEmbed()
              nextTrack()
            }}
          >
            <Icon name="chevronRight" size={18} />
          </button>
        </div>
        <button
          type="button"
          id="ytEmbedClose"
          title="Close (Esc)"
          aria-label="Close YouTube player"
          onClick={closeEmbed}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      <div id="ytEmbedStage">
        <iframe
          id="ytEmbedFrame"
          ref={frame}
          src={src}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
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
          YouTube items play here rather than as an audio stream. YouTube’s own controls and
          its advertising apply.
        </p>
      )}
    </div>
  )
}
