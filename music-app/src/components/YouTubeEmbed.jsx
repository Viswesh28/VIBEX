import { useCallback, useEffect, useMemo } from 'react'
import { decodeHtml } from '../lib/format.js'
import { embedUrl } from '../lib/ytEmbed.js'
import { Icon } from './Icon.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'

/**
 * YouTube's own player, for the things that are not tracks.
 *
 * Rendering this is the whole feature: the embed is a black box we deliberately
 * do not drive, so there is no transport to wire and nothing here can drift out
 * of sync with YouTube's protocol. Escape and the close button are the only
 * controls we own, and both do the same thing — close it and leave the local
 * player exactly where it was.
 *
 * Nothing is fetched, minted or probed. If YouTube refuses the video (private,
 * region-locked, embed-disabled) it says so inside its own frame, in its own
 * words, which is more accurate than anything this app could infer.
 */
export function YouTubeEmbed() {
  const { longForm, closeLongForm } = usePlayer()
  const open = Boolean(longForm)

  const src = useMemo(() => {
    if (!longForm) return null
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return embedUrl({ videoId: longForm.videoId }, { origin, autoplay: true })
  }, [longForm])

  const onKey = useCallback(
    (e) => {
      if (e.key === 'Escape') closeLongForm()
    },
    [closeLongForm]
  )

  useEffect(() => {
    if (!open) return undefined
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onKey])

  if (!open || !src) return null

  const title = decodeHtml(longForm.name || 'YouTube video')
  const artist = longForm.subtitle ? decodeHtml(longForm.subtitle) : ''

  return (
    <div id="ytEmbed" role="dialog" aria-modal="true" aria-label="YouTube player">
      <div id="ytEmbedHead">
        <div id="ytEmbedMeta">
          <Icon name="music" size={16} />
          <b>{title}</b>
          {artist && <span>{artist}</span>}
        </div>
        <button
          type="button"
          id="ytEmbedClose"
          title="Close (Esc)"
          aria-label="Close YouTube player"
          onClick={closeLongForm}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      <div id="ytEmbedStage">
        <iframe
          id="ytEmbedFrame"
          src={src}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <p id="ytEmbedNote">
        Long videos play here rather than as an audio stream. YouTube’s own controls and
        its advertising apply.
      </p>
    </div>
  )
}
