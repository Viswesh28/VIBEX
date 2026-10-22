/**
 * YouTube's own player, and the URL that opens it.
 *
 * Every YouTube item plays here — it is not a long-form carve-out any more.
 * Nothing in this repository extracts YouTube audio: the player endpoint
 * refuses a foreign `Origin`, the device mint needed a shim whose URLs can 403
 * a minute into a track, and neither is worth maintaining for a catalogue we
 * cannot serve on our own terms. The embed streams from YouTube to the
 * listener, costs this deployment nothing, and cannot be broken by a change to
 * `n`, a PO token or a client ladder — because it is YouTube's client, not
 * ours.
 *
 * Two consequences worth stating, because they are the reason this lives in its
 * own module rather than inside `sources.js`:
 *
 * * The embed is **video**, and it is not muted. It is a different thing from
 *   the audio player: no crossfade, no visualiser, no offline. `PlayerContext`
 *   pauses the local decks before it opens, so there is never a mix of the two.
 * * `LONG_FORM_SEC` survives as a *reason*, not a rule. An hour-long mix and a
 *   three-minute track both embed; only the sentence differs.
 *
 * Pure functions only: the URL, the threshold, the id. No DOM, no network, so
 * the policy is testable in Node like the rest of the engine.
 */

/** Twenty minutes. Above this the copy says "mix" instead of "track". */
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

/**
 * What YouTube's own player says when it refuses to play.
 *
 * The frame is cross-origin, so its words are unreadable from here. What *is*
 * readable is the error code it posts to the parent once the JS API handshake
 * is up (`enablejsapi=1` plus a matching `origin`). The codes are YouTube's:
 *
 *   2          the id is not a video
 *   5          the HTML5 player could not start this one
 *   100        private, removed, or not available in this country
 *   101 / 150  the rights holder forbids playback outside youtube.com
 *
 * 101/150 is the one that matters in practice: a catalogue item can exist, be
 * searchable and still be unplayable in an embed, and until this was surfaced
 * the app showed a black rectangle and blamed nothing.
 */
export const EMBED_ERROR = {
  invalid: 'invalid_id',
  failed: 'player_failed',
  gone: 'not_available',
  blocked: 'embedding_disabled',
}

/** The reason for a code YouTube posted, or '' when it is not one we know. */
export function embedErrorReason(code) {
  switch (Number(code)) {
    case 2:
      return EMBED_ERROR.invalid
    case 5:
      return EMBED_ERROR.failed
    case 100:
      return EMBED_ERROR.gone
    case 101:
    case 150:
      return EMBED_ERROR.blocked
    default:
      return ''
  }
}

/** The sentence for that reason, including the way out. '' when unknown. */
export function embedErrorCopy(code) {
  switch (embedErrorReason(code)) {
    case EMBED_ERROR.invalid:
      return 'YouTube does not recognise this video id — pick another result.'
    case EMBED_ERROR.failed:
      return 'YouTube’s player could not start this video. Open it on YouTube to listen there.'
    case EMBED_ERROR.gone:
      return 'This video is private, removed, or not available in your country.'
    case EMBED_ERROR.blocked:
      return 'The rights holder has disabled playback outside YouTube. Open it on YouTube to listen there.'
    default:
      return ''
  }
}
