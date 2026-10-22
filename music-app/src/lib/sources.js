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
    note: 'Full catalogue and playback, on every device.',
  },
  {
    id: SOURCE_ID.ytmusic,
    label: 'YouTube Music',
    short: 'YT Music',
    /** Catalogue only; audio needs a session this deployment does not have. */
    plays: 'catalogue-only',
    note: 'Browse and search only. YouTube will not serve audio to this server, so these tracks cannot play here yet.',
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
    ? `/ytmusic/search?query=${q}&limit=${limit}`
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
}

export const PLAYBACK_COPY = {
  [PLAYBACK_REASON.noStream]: 'This track has no stream to play.',
  [PLAYBACK_REASON.needsSession]:
    'YouTube Music audio needs a signed-in session, which this server does not have — choose JioSaavn to play.',
  [PLAYBACK_REASON.needsApp]:
    'YouTube Music tracks play in the Android app only — choose JioSaavn here.',
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
 * `native` is only true in the Capacitor shell, and even there YouTube audio is
 * not wired yet — the canvas mint exists, an audio mint does not. Saying so is
 * the point: a plan that guessed "probably" would surface as a broken player.
 */
export function playbackPlan(track, { native = false } = {}) {
  if (!track) return { playable: false, reason: PLAYBACK_REASON.noStream }
  if (isYtTrack(track)) {
    return {
      playable: false,
      reason: native ? PLAYBACK_REASON.needsSession : PLAYBACK_REASON.needsApp,
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
