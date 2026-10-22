/**
 * Choosing where the music comes from.
 *
 * VIBEX used to have exactly one source, so "where does this come from" was not
 * a question the app had to ask. It has two now, and they are not equivalent —
 * so the registry below is deliberately more interested in what each source can
 * *actually do here* than in presenting them as interchangeable.
 *
 * JioSaavn: catalogue and audio both work, everywhere.
 *
 * YouTube Music: the catalogue works, because search answers this deployment.
 * The audio does not, for a reason that lives in docs/adr/0001 — the player
 * endpoint refuses a client with no session from this sort of address. Rather
 * than hide that behind a spinner or a silent skip, `playbackPlan` returns a
 * typed reason that the UI repeats verbatim.
 *
 * Nothing here talks to the network, so the whole policy is testable.
 */

import { isLongForm, videoIdOf } from './ytEmbed.js'

/**
 * The limit, in one sentence.
 *
 * Every surface that mentions the limit — the header banner, the Settings
 * panel, the capability matrix — renders this constant rather than its own
 * paraphrase. Drift here is the difference between "browse-only" and a vague
 * promise someone reads as "it will probably play".
 */
export const BROWSE_ONLY_NOTE =
  'YouTube Music is browse-only here: YouTube will not serve audio to this server, so these tracks cannot play. Switch to JioSaavn to listen.'

/**
 * The same limit on Android, where the app *can* resolve the audio itself.
 *
 * Said carefully on purpose: the mint is real, but it is also the newest and
 * least exercised path in the app, and a listener should hear "it may be
 * refused" before it is, not after. JioSaavn is still the answer that always
 * plays, so that stays the last clause on both platforms.
 */
export const DEVICE_SOURCE_NOTE =
  'YouTube Music audio is resolved on this device, from a page in the app: it takes a few seconds and YouTube may still refuse it. JioSaavn is the source that always plays.'

export const SOURCE_ID = {
  jiosaavn: 'jiosaavn',
  ytmusic: 'ytmusic',
}

export const SOURCES = [
  {
    id: SOURCE_ID.jiosaavn,
    label: 'JioSaavn',
    short: 'Saavn',
    /** Catalogue + audio, in every build. */
    plays: 'here',
    note: 'JioSaavn provides both the catalogue and the audio, on every device.',
  },
  {
    id: SOURCE_ID.ytmusic,
    label: 'YouTube Music',
    short: 'YT Music',
    /** Catalogue only; audio needs a session this deployment does not have. */
    plays: 'catalogue-only',
    note: BROWSE_ONLY_NOTE,
  },
]

const BY_ID = new Map(SOURCES.map((s) => [s.id, s]))

export function sourceOf(id) {
  return BY_ID.get(id) || BY_ID.get(SOURCE_ID.jiosaavn)
}

/** Is this setting value one we recognise? Anything else means JioSaavn. */
export function normalizeSource(id) {
  return BY_ID.has(id) ? id : SOURCE_ID.jiosaavn
}

/** The catalogue endpoint for a source; both return `{ results: [...] }`. */
export function cataloguePath(source, query, limit = 20) {
  const q = encodeURIComponent(query)
  return source === SOURCE_ID.ytmusic
    ? `/ytmusic?query=${q}&limit=${limit}`
    : `/search/songs?query=${q}&limit=${limit}`
}

/** Playback outcomes, kept apart from the canvas reasons on purpose. */
export const PLAYBACK_REASON = {
  ok: 'ok',
  /** The track carries no stream at all. */
  noStream: 'no_stream',
  /** YouTube Music audio, and YouTube refuses to mint it for this deployment. */
  needsSession: 'needs_youtube_session',
  /** YouTube Music audio in a build that cannot ask a page for it. */
  needsApp: 'needs_app',
  /**
   * The device-side mint is the only path to YouTube audio, and it did not
   * produce a URL. The specific reason lives in `ytStream.js`; this is the
   * picker-level summary, and it still names the source that will work.
   */
  mintFailed: 'mint_failed',
  /**
   * Too long to be a stream. Played by YouTube's own embed instead, which is a
   * different kind of playback: video, YouTube's transport, no crossfade.
   */
  longForm: 'long_form',
}

export const PLAYBACK_COPY = {
  [PLAYBACK_REASON.noStream]: 'This track has no stream to play.',
  [PLAYBACK_REASON.needsSession]:
    'YouTube Music audio needs a signed-in session, which this server does not have — choose JioSaavn to play.',
  [PLAYBACK_REASON.needsApp]:
    'YouTube Music audio needs the Android app or the VIBEX browser extension — choose JioSaavn to play.',
  [PLAYBACK_REASON.mintFailed]:
    'YouTube Music audio could not be resolved on this device — choose JioSaavn to play.',
  [PLAYBACK_REASON.longForm]:
    'This is a long video, so it opens in YouTube’s own player instead of streaming as audio here.',
}

/** True when a track came from the YouTube Music catalogue. */
export function isYtTrack(track) {
  return (
    track?.source === SOURCE_ID.ytmusic ||
    String(track?.id || '').startsWith('yt:') ||
    Boolean(track?.videoId)
  )
}

/**
 * Can this track play, here?
 *
 * A YouTube track carries no URL, so this can never answer "yes" for one —
 * what it answers is *how it will be attempted*. On Android the app mints a URL
 * from a real page on the device (see `ytStream.js`), so `willMint` is true and
 * the caller owns the async attempt; anywhere else the refusal is final and
 * says so. `playable` stays false either way, because playing it is not a fact
 * until a URL lands.
 *
 * `embed` says the caller has YouTube's own player available (a browser tab).
 * It changes one thing: a YouTube item past `LONG_FORM_SEC` comes back as
 * `mode: 'embed'` rather than as a mint, because an hour-long mix is not a
 * track and streaming it here serves nobody.
 */
export function playbackPlan(track, { native = false, canMint = false, embed = false } = {}) {
  if (!track) return { playable: false, reason: PLAYBACK_REASON.noStream }
  if (isYtTrack(track)) {
    // Long-form first: no mint is attempted for it at all, because a real file
    // that size is the worst case for both the listener and the provider. Only
    // a browser tab has an origin YouTube's embed will accept, so the app
    // (`native`) keeps minting and never takes this branch.
    if (embed && !native && isLongForm(track)) {
      return {
        playable: false,
        mode: 'embed',
        videoId: videoIdOf(track),
        reason: PLAYBACK_REASON.longForm,
      }
    }
    // `canMint` is the browser extension. Native always can; a plain tab never.
    const mint = native || canMint
    return {
      playable: false,
      ...(mint ? { willMint: true } : {}),
      reason: mint ? PLAYBACK_REASON.mintFailed : PLAYBACK_REASON.needsApp,
    }
  }
  if (!track?.downloadUrl?.length) {
    return { playable: false, reason: PLAYBACK_REASON.noStream }
  }
  return { playable: true, reason: PLAYBACK_REASON.ok }
}

/** The sentence for a reason, or '' when there is nothing to explain. */
export function playbackCopy(reason) {
  return PLAYBACK_COPY[reason] || ''
}

/**
 * Map one YouTube Music search result onto the shape the rest of the app reads.
 *
 * The app's readers (`artistsOf`, `imgOf`, `streamOf`) all expect Saavn field
 * names, so a YouTube result is dressed in them rather than teaching every
 * component a second shape. `downloadUrl` is empty on purpose — there is no
 * stream, and an empty list is what the player already treats as unplayable.
 */
export function mapYtResult(raw) {
  if (!raw?.videoId || !raw?.title) return null
  const artists = Array.isArray(raw.artists) ? raw.artists.filter(Boolean) : []
  const artist = artists.join(', ') || 'Unknown artist'
  return {
    id: `yt:${raw.videoId}`,
    videoId: raw.videoId,
    source: SOURCE_ID.ytmusic,
    name: raw.title,
    subtitle: raw.subtitle || [artist, raw.album].filter(Boolean).join(' • '),
    duration: Number(raw.duration) || 0,
    album: raw.album ? { name: raw.album } : null,
    artists: { primary: artists.map((name) => ({ name })), all: [] },
    image: raw.thumbnail ? [{ quality: '500x500', url: raw.thumbnail }] : [],
    downloadUrl: [],
    url: `https://music.youtube.com/watch?v=${raw.videoId}`,
  }
}

/** Map a whole result set, dropping anything malformed. */
export function mapYtResults(list) {
  if (!Array.isArray(list)) return []
  return list.map(mapYtResult).filter(Boolean)
}
