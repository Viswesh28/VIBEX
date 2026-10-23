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
  'YouTube Music songs and videos play right here as pure audio tracks — no video window.'

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
    /** Songs and videos converted & streamed here as pure audio tracks. */
    plays: 'here',
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
export function cataloguePath(source, query, limit = 20, pageToken = null) {
  const q = encodeURIComponent(query)
  if (source === SOURCE_ID.ytmusic) {
    const tokenPart = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''
    return `/ytmusic?query=${q}&limit=${limit}${tokenPart}`
  }
  const pagePart = pageToken ? `&page=${encodeURIComponent(pageToken)}` : ''
  return `/search/songs?query=${q}&limit=${limit}${pagePart}`
}

/** Playback outcomes, kept apart from the canvas reasons on purpose. */
export const PLAYBACK_REASON = {
  ok: 'ok',
  /** The track carries no stream at all. */
  noStream: 'no_stream',
  /** YouTube Music audio, and YouTube will not describe it to a server. */
  needsSession: 'needs_youtube_session',
  /**
   * Too long to be a stream. Played by YouTube's own embed instead, which is a
   * different kind of playback: video, YouTube's transport, no crossfade.
   */
  longForm: 'long_form',
  /** A YouTube item, played by YouTube's own player. This is the normal path. */
  embed: 'embed',
  /** A YouTube item the catalogues could not give a usable 11-character id. */
  noVideo: 'no_video',
}

export const PLAYBACK_COPY = {
  [PLAYBACK_REASON.noStream]: 'This track has no stream to play.',
  [PLAYBACK_REASON.needsSession]:
    'YouTube Music audio needs an active connection — choose JioSaavn to play.',
  [PLAYBACK_REASON.longForm]:
    'Playing long-form YouTube audio track right here in the player bar.',
  [PLAYBACK_REASON.embed]: 'Playing YouTube audio track right here in the player bar.',
  [PLAYBACK_REASON.noVideo]: 'This YouTube item has no playable track id — choose JioSaavn to play.',
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
 * Can this track play here, and if not, where does it go?
 *
 * A YouTube track carries no URL, so this can never answer "yes" for one.
 * What it answers is *where the item plays*: an `mode: 'embed'` plan hands the
 * video id to YouTube's own player, and `playable` stays false because the
 * embed is not our transport, our playhead or our crossfade.
 *
 * YouTube items are embed-only. There is no minting path any more: every
 * client — browser tab, Android WebView, anything else — hands a YouTube item
 * to YouTube's own player. Extraction of any kind is out of scope by decision,
 * so `willMint` is never returned for one.
 *
 * `embed` still has to be passed, because a caller without YouTube's player
 * available cannot do anything with the item; such a caller gets a named
 * refusal rather than a silent no-op.
 */
export function playbackPlan(track, { native = false, canMint = false, embed = false } = {}) {
  if (!track) return { playable: false, reason: PLAYBACK_REASON.noStream }
  if (isYtTrack(track)) {
    const videoId = videoIdOf(track)
    if (!videoId) {
      // Nothing to hand to the iframe, so this is a real refusal.
      return { playable: false, reason: PLAYBACK_REASON.noVideo }
    }
    if (!embed) {
      return { playable: false, reason: PLAYBACK_REASON.embed }
    }
    // Long-form is still worth naming separately: it explains why the item is
    // a video rather than a track, which is what the copy says.
    return {
      playable: false,
      mode: 'embed',
      videoId,
      reason: isLongForm(track) ? PLAYBACK_REASON.longForm : PLAYBACK_REASON.embed,
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
  const matched = raw.matchedAudio && Array.isArray(raw.matchedAudio.downloadUrl) && raw.matchedAudio.downloadUrl.length
    ? raw.matchedAudio
    : null
  const ytImages = raw.thumbnail ? [{ quality: '500x500', url: raw.thumbnail }] : []
  const images = matched?.image?.length ? matched.image : ytImages
  const primaryArtists = matched?.artists?.primary?.length
    ? artists.length
      ? artists.map((name, i) => ({
          name,
          ...(matched.artists.primary[i]?.id ? { id: matched.artists.primary[i].id } : {}),
        }))
      : matched.artists.primary
    : artists.map((name) => ({ name }))

  return {
    id: `yt:${raw.videoId}`,
    key: `ytmusic:${raw.videoId}`,
    provider: SOURCE_ID.ytmusic,
    providerTrackId: raw.videoId,
    videoId: raw.videoId,
    source: SOURCE_ID.ytmusic,
    ...(matched?.songId ? { _matchedSaavnId: matched.songId } : {}),
    name: raw.title,
    subtitle: raw.subtitle || [artist, raw.album || matched?.album?.name].filter(Boolean).join(' • '),
    duration: Number(raw.duration) || Number(matched?.duration) || 0,
    explicitContent: raw.explicit ? 1 : 0,
    album: raw.album ? { name: raw.album } : matched?.album || null,
    artists: { primary: primaryArtists, all: matched?.artists?.all || [] },
    image: images,
    downloadUrl: matched ? matched.downloadUrl : [],
    url: `https://music.youtube.com/watch?v=${raw.videoId}`,
  }
}

/** Map a whole result set, dropping anything malformed. */
export function mapYtResults(list) {
  if (!Array.isArray(list)) return []
  return list.map(mapYtResult).filter(Boolean)
}
