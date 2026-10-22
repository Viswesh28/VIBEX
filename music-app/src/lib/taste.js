// ==========================================================================
// Taste — turning play history into a ranked signal.
// --------------------------------------------------------------------------
// The stats store has always recorded plays and seconds. That is enough to
// rank, but only if the numbers are read honestly:
//
//   * a play that was skipped after 8 seconds is not a preference
//   * last year's obsession is not this month's taste
//   * one artist played forty times should not drown out everything else
//
// This module is pure: it takes the stored stats plus the user's exclusions
// and returns scores. Nothing here touches storage, the network or React, so
// the weighting can be unit-tested and argued about.
// ==========================================================================

export const TASTE = {
  /** Below this many recorded plays the profile is "cold" and nothing is driven by it. */
  minPlays: 5,
  /** A play's weight halves every this many days. */
  halfLifeDays: 14,
  /** Under this completion ratio a play counts as a skip. */
  completionFloor: 0.15,
  /** How much a skip is worth relative to a full listen. */
  skipWeight: 0.3,
  /** Do not suggest a track the listener finished this recently. */
  recentlyPlayedDays: 3,
  /** How many seed artists a personal shelf may draw from. */
  maxSeeds: 3,
  /** Weight of the "did they listen to the end" term vs. raw play count. */
  completionWeight: 0.6,
}

const DAY_MS = 24 * 60 * 60 * 1000

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n)

/**
 * A stable key for an artist name: lower-cased, punctuation and bracketed
 * suffixes stripped. "A. R. Rahman" and "A R Rahman" must collide; "Anirudh
 * Ravichander (feat. Someone)" must not become a different artist.
 */
export function artistKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(feat|ft|featuring)\b.*$/, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Every artist credited on a stats entry ("A, B" → [a, b]). */
export function artistKeysOf(credit) {
  return String(credit || '')
    .split(',')
    .map(artistKey)
    .filter(Boolean)
}

/**
 * Recency decay: 1 today, 0.5 after one half-life, approached 0 as history
 * ages. An entry with no timestamp is treated as one half-life old rather
 * than as brand new — missing data should not be rewarded.
 */
export function recencyWeight(lastMs, now = Date.now(), cfg = {}) {
  const c = { ...TASTE, ...cfg }
  const last = Number(lastMs)
  if (!Number.isFinite(last) || last <= 0) return 0.5
  const days = Math.max(0, (now - last) / DAY_MS)
  return Math.pow(0.5, days / Math.max(1, c.halfLifeDays))
}

/**
 * One stored song entry → a single weight.
 *
 * `sec` is total seconds credited to the song and `n` the number of plays, so
 * `sec / (n * duration)` estimates how much of each play was heard.
 */
export function songWeight(entry, now = Date.now(), cfg = {}) {
  const c = { ...TASTE, ...cfg }
  const plays = Number(entry?.n) || 0
  if (plays <= 0) return 0
  const sec = Number(entry?.sec) || 0
  const dur = Number(entry?.dur) || 0
  // With no duration on file, assume a listen was a listen.
  const completion = dur > 0 ? clamp01(sec / (plays * dur)) : 0.5
  const listened = 1 - c.completionWeight + c.completionWeight * completion
  const skip = completion < c.completionFloor ? c.skipWeight : 1
  return plays * listened * skip * recencyWeight(entry?.last, now, c)
}

/**
 * Build the taste profile.
 *
 * Returns `{ ready, plays, artists, topArtist, songScores }`, where `artists`
 * is sorted descending. `ready === false` means "cold start": callers must
 * show the editorial feed exactly as before.
 */
export function buildTaste(stats, { excluded = [], now = Date.now(), cfg = {} } = {}) {
  const c = { ...TASTE, ...cfg }
  const excludedKeys = new Set(
    (Array.isArray(excluded) ? excluded : []).map(artistKey).filter(Boolean)
  )
  const byArtist = new Map()
  const songScores = new Map()
  let plays = 0

  const songs = stats?.songs && typeof stats.songs === 'object' ? stats.songs : {}
  for (const [id, entry] of Object.entries(songs)) {
    const w = songWeight(entry, now, c)
    if (w <= 0) continue
    plays += Number(entry?.n) || 0
    const keys = artistKeysOf(entry?.artist)
    if (!keys.length) continue
    // A song credited to an excluded artist contributes nothing: excluding an
    // artist must not leave half its weight behind.
    if (keys.some((k) => excludedKeys.has(k))) continue
    songScores.set(id, w)
    for (const key of keys) {
      const prev = byArtist.get(key) || { key, label: labelFor(entry, key), score: 0, plays: 0 }
      prev.score += w / keys.length
      prev.plays += Number(entry?.n) || 0
      if (!prev.label) prev.label = labelFor(entry, key)
      byArtist.set(key, prev)
    }
  }

  const artists = [...byArtist.values()].sort((a, b) => b.score - a.score)
  const total = artists.reduce((n, a) => n + a.score, 0)
  if (total > 0) artists.forEach((a) => (a.norm = a.score / total))

  return {
    ready: plays >= c.minPlays && artists.length > 0,
    plays,
    artists,
    topArtist: artists[0]?.label || null,
    songScores,
  }
}

function labelFor(entry, key) {
  const parts = String(entry?.artist || '').split(',')
  const match = parts.find((p) => artistKey(p) === key)
  return (match || parts[0] || '').trim()
}

/** Normalised affinity for one artist name, 0 when unknown or excluded. */
export function affinity(artistName, taste) {
  if (!taste?.artists?.length) return 0
  const key = artistKey(artistName)
  const hit = taste.artists.find((a) => a.key === key)
  return hit ? hit.norm || 0 : 0
}

/**
 * Affinity of a candidate song: its best-credited artist wins, so a duet with
 * a favourite is not penalised by the second name.
 */
export function songAffinity(song, taste) {
  if (!taste?.artists?.length) return 0
  const credits = (song?.artists?.primary?.length ? song.artists.primary : song?.artists?.all || []).map(
    (a) => a?.name
  )
  if (!credits.length && song?.subtitle) credits.push(song.subtitle)
  // One credit entry can name several artists ("A, B"); each key is scored.
  const keys = artistKeysOf(credits.join(','))
  return keys.reduce((best, key) => {
    const hit = taste.artists.find((a) => a.key === key)
    return Math.max(best, hit ? hit.norm || 0 : 0)
  }, 0)
}

/**
 * Rank a candidate pool by taste.
 *
 * Filters come first — dismissed, excluded artists, and anything in the queue
 * are removed, not merely down-ranked — then affinity, with a recency penalty
 * so the app does not keep proposing what you just heard.
 */
export function rankByTaste(
  songs,
  taste,
  { excluded = [], dismissed = null, inQueue = null, recentlyPlayed = null, now = Date.now(), cfg = {}, rand = Math.random } = {}
) {
  const c = { ...TASTE, ...cfg }
  if (!Array.isArray(songs) || !songs.length) return []
  const excludedKeys = new Set((excluded || []).map(artistKey).filter(Boolean))
  const dismissedSet = dismissed instanceof Set ? dismissed : new Set(dismissed || [])
  const queueSet = inQueue instanceof Set ? inQueue : new Set(inQueue || [])
  const recent = recentlyPlayed instanceof Set ? recentlyPlayed : new Set(recentlyPlayed || [])
  const seen = new Set()

  const scored = []
  for (const song of songs) {
    if (!song?.id || seen.has(song.id)) continue
    seen.add(song.id)
    if (!song.downloadUrl?.length) continue
    if (dismissedSet.has(song.id) || queueSet.has(song.id) || recent.has(song.id)) continue
    const keys = artistKeysOf(
      (song.artists?.primary?.length ? song.artists.primary : song.artists?.all || [])
        .map((a) => a?.name)
        .join(',')
    )
    if (keys.some((k) => excludedKeys.has(k))) continue

    const score =
      songAffinity(song, taste) +
      // Deterministic-ish tie-break so the same pool does not always order the same.
      rand() * 0.02
    scored.push({ song, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.map((x) => x.song)
}

/**
 * Ids heard recently enough that re-proposing them would feel broken.
 * `days` is deliberately small: the point is to avoid the last few days, not
 * to bury a song forever.
 */
export function recentlyPlayedIds(stats, now = Date.now(), cfg = {}) {
  const c = { ...TASTE, ...cfg }
  const cutoff = now - c.recentlyPlayedDays * DAY_MS
  const out = new Set()
  const songs = stats?.songs && typeof stats.songs === 'object' ? stats.songs : {}
  for (const [id, entry] of Object.entries(songs)) {
    if ((Number(entry?.last) || 0) >= cutoff) out.add(id)
  }
  return out
}

/** Seed artists for a personalised shelf, best first, de-duplicated. */
export function pickSeeds(taste, n = TASTE.maxSeeds) {
  if (!taste?.ready) return []
  return taste.artists.slice(0, Math.max(0, n)).map((a) => a.label).filter(Boolean)
}

/** One-line explanation for a shelf header, or null when there is nothing to say. */
export function describeTaste(taste) {
  if (!taste?.ready || !taste.topArtist) return null
  return `Because you keep playing ${taste.topArtist}`
}
