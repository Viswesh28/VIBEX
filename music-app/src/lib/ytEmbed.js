/**
 * Long-form YouTube items, played by YouTube's own player.
 *
 * A minted URL is one file fetched by this tab. That is the right shape for a
 * three-minute track and the wrong shape for an hour-long mix: the bytes are
 * still real, the tab still has to pull them, and every one of YouTube's
 * counter-measures applies to a file that size just the same. Rather than
 * pretend a 70–200 MB item is a track, anything past `LONG_FORM_SEC` is handed
 * to YouTube's own embed, which streams from YouTube to the listener, costs
 * this deployment nothing, and cannot be broken by a change to `n`, a PO token
 * or a client ladder — because it is YouTube's client, not ours.
 *
 * Two consequences worth stating, because they are the reason this lives in its
 * own module rather than inside `sources.js`:
 *
 * * The embed is **video**, and it is not muted. It is a different thing from
 *   the audio player: no crossfade, no visualiser, no offline. `PlayerContext`
 *   pauses the local decks before it opens, so there is never a mix of the two.
 * * It only exists in a browser tab. A WebView's origin is not one YouTube's
 *   embed accepts, and the app has a real mint there anyway, so the app keeps
 *   streaming long items as audio and never takes this path.
 *
 * Pure functions only: the URL, the threshold, the id. No DOM, no network, so
 * the policy is testable in Node like the rest of the engine.
 */

/** Twenty minutes. Above this, a mix is a mix, not a track. */
export const LONG_FORM_SEC = 20 * 60

/** The id inside a track, whichever shape it arrived in. '' when there is none. */
export function videoIdOf(track) {
  if (!track) return ''
  const direct = String(track.videoId || '')
  if (/^[A-Za-z0-9_-]{11}$/.test(direct)) return direct
  const fromId = /^yt:([A-Za-z0-9_-]{11})$/.exec(String(track.id || ''))
  return fromId ? fromId[1] : ''
}

/** Is this a YouTube item long enough to belong in the embed? */
export function isLongForm(track) {
  const id = videoIdOf(track)
  if (!id) return false
  const secs = Number(track?.duration) || 0
  return secs >= LONG_FORM_SEC
}

/**
 * The embed URL, or null when the track has no usable id.
 *
 * `origin` is passed when available: YouTube uses it to bind the postMessage
 * channel, and a mismatch there is the usual reason an embed loads but reports
 * nothing. The player is ours to configure in only these ways — `rel=0` keeps
 * the end screen from becoming a recommendation wall, `playsinline` stops iOS
 * hijacking the video into fullscreen, and `enablejsapi` is left on so a future
 * transport can drive it without changing the URL shape.
 */
export function embedUrl(track, { origin = '', autoplay = true } = {}) {
  const id = videoIdOf(track)
  if (!id) return null
  const q = new URLSearchParams({
    autoplay: autoplay ? '1' : '0',
    rel: '0',
    playsinline: '1',
    enablejsapi: '1',
    modestbranding: '1',
  })
  if (origin) q.set('origin', origin)
  return `https://www.youtube.com/embed/${id}?${q.toString()}`
}

/** The line the status bar shows while the embed is open. */
export const EMBED_NOTE =
  'Playing in YouTube’s own player — YouTube’s video and ads, not our audio stream.'
