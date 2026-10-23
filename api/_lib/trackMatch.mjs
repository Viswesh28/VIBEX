// ==========================================================================
// Cross-catalog studio track matcher (metadata-only, zero stream extraction).
// --------------------------------------------------------------------------
// Matches a catalog entry's `(title, artists, album, duration)` metadata
// against licensed/authorized JioSaavn catalog candidates so tracks selected
// while browsing YouTube Music play as native studio audio (`<audio>`) whenever
// an exact studio recording exists, and fall back to YouTube's official embed
// player otherwise.
// ==========================================================================

const EDITION_MODIFIERS = [
  'remix',
  'slowed',
  'reverb',
  'lofi',
  'lo-fi',
  'karaoke',
  'instrumental',
  'cover',
  'live',
  'unplugged',
  'acoustic',
  'mashup',
  '8d',
]

const VIDEO_NOISE_RE =
  /\b(official\s+(music\s+|lyric\s+)?(video|audio|visualizer)|lyric(al)?(\s+video|\s+song)?|video\s+song|full\s+(video|audio|song)(\s+song)?|audio\s+song|4k|8k|uhd|hd\s+video|dolby\s+atmos|mv|m\/v)\b/gi

const GENERIC_LABELS = new Set([
  'unknown artist',
  'various artists',
  'sun tv',
  'sun pictures',
  'sony music south',
  'sony music india',
  't series',
  'tseries',
  't series tamil',
  't series telugu',
  'think music india',
  'saregama tamil',
  'saregama music',
  'lahari music',
  'zee music company',
  'zee music south',
  'tips official',
  'yrf',
  'aditya music',
  'junglee music',
  'mythri movie makers',
  'hombale films',
])

const TITLE_STOPWORDS = new Set(['from', 'the', 'song', 'ost', 'motion', 'picture', 'soundtrack'])

/** Decode common HTML entities present in JioSaavn and YouTube snippets. */
export function unescapeEntities(value) {
  return String(value || '')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

/** Parse ISO-8601 duration strings from YouTube Data API v3 (`PT3M20S` → `200`). */
export function parseIsoDuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(String(iso || '').trim())
  if (!m) return 0
  const hours = Number(m[1] || 0)
  const minutes = Number(m[2] || 0)
  const seconds = Number(m[3] || 0)
  return hours * 3600 + minutes * 60 + seconds
}

/** Clean YouTube channel suffixes (`"Anirudh - Topic"` → `"Anirudh"`, `"TheWeekndVEVO"` → `"The Weeknd"`). */
export function cleanChannelArtist(raw) {
  let s = unescapeEntities(raw).trim()
  if (!s) return ''
  s = s.replace(/\s*-\s*topic$/i, '').trim()
  if (/vevo$/i.test(s) && s.length > 4) {
    s = s
      .replace(/vevo$/i, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim()
  }
  s = s.replace(/\b(official|music)\s*$/i, '').trim()
  return s || unescapeEntities(raw).trim()
}

/** Normalize text to comparable lowercase alphanumeric/script tokens. */
export function normalizeText(value) {
  return unescapeEntities(value)
    .toLowerCase()
    .replace(/[\u2018\u2019`']/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function significantTokens(value) {
  const all = normalizeText(value).split(' ').filter(Boolean)
  const filtered = all.filter((t) => !TITLE_STOPWORDS.has(t))
  return filtered.length ? filtered : all
}

function extractModifiers(text) {
  const low = unescapeEntities(text).toLowerCase()
  const found = new Set()
  for (const mod of EDITION_MODIFIERS) {
    const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(low)) {
      found.add(mod === 'lo-fi' ? 'lofi' : mod)
    }
  }
  return found
}

function stripMovieClause(segment) {
  return segment
    .replace(/\(\s*from\s+["']?([^"')]+)["']?\s*\)/gi, ' ')
    .replace(/\[\s*from\s+["']?([^"\]]+)["']?\s*\]/gi, ' ')
}

function stripNoise(segment) {
  return stripMovieClause(segment)
    .replace(/\([^)]*\)/g, (clause) => {
      const cleaned = clause.replace(VIDEO_NOISE_RE, '').replace(/[()\s-]+/g, '')
      return cleaned ? ` ${clause} ` : ' '
    })
    .replace(/\[[^\]]*\]/g, (clause) => {
      const cleaned = clause.replace(VIDEO_NOISE_RE, '').replace(/[\[\]\s-]+/g, '')
      return cleaned ? ` ${clause} ` : ' '
    })
    .replace(VIDEO_NOISE_RE, ' ')
    .replace(/\s*[-–—:]\s*$/g, '')
    .replace(/^\s*[-–—:]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractArtistNames(track) {
  if (!track) return []
  if (Array.isArray(track.artists)) {
    return track.artists.map((a) => cleanChannelArtist(typeof a === 'string' ? a : a?.name)).filter(Boolean)
  }
  const primary = track.artists?.primary || track.artists?.all || []
  if (Array.isArray(primary) && primary.length) {
    return primary.map((a) => cleanChannelArtist(a?.name || a)).filter(Boolean)
  }
  return []
}

/**
 * Decompose a raw YouTube / catalog track into clean search components:
 * - `coreTitle`: primary song title stripped of video tags and pipe metadata
 * - `artists`: non-label artist names
 * - `contextHints`: album / film / artist clues from pipe segments & subtitle
 * - `modifiers`: special edition tags (`remix`, `lofi`, `cover`, `live`, etc.)
 */
export function extractTrackQueryParts(track) {
  const rawTitle = unescapeEntities(track?.name ?? track?.title ?? '').trim()
  const modifiers = extractModifiers(rawTitle)

  // Capture `(From "Movie")` hints before stripping video clauses.
  const contextHints = []
  for (const m of rawTitle.matchAll(/from\s+["']([^"']+)["']/gi)) {
    if (m[1]) contextHints.push(m[1].trim())
  }

  const pipeParts = rawTitle.split('|').map((p) => p.trim()).filter(Boolean)
  let head = pipeParts[0] || rawTitle
  for (const extra of pipeParts.slice(1)) {
    const cleaned = stripNoise(extra)
    if (cleaned) contextHints.push(cleaned)
  }

  const rawArtists = extractArtistNames(track)
  const realArtists = rawArtists.filter((a) => !GENERIC_LABELS.has(normalizeText(a)))

  // If title is written `"Artist - Song Title"`, peel off the leading artist prefix.
  const dashParts = head.split(/\s+[-–—]\s+/).map((p) => stripNoise(p)).filter(Boolean)
  if (dashParts.length >= 2) {
    const firstNorm = normalizeText(dashParts[0])
    const matchesKnownArtist = realArtists.some((a) => {
      const an = normalizeText(a)
      return an && (an === firstNorm || firstNorm.includes(an) || an.includes(firstNorm))
    })
    if (matchesKnownArtist) {
      head = dashParts.slice(1).join(' - ')
    } else {
      // Drop trailing `" - Video Song"` style empty remnants after `stripNoise`.
      head = dashParts[0]
      for (const rest of dashParts.slice(1)) contextHints.push(rest)
    }
  } else {
    head = stripNoise(head)
  }

  const albumName =
    typeof track?.album === 'string' ? track.album : track?.album?.name || ''
  if (albumName) contextHints.push(unescapeEntities(albumName))
  if (track?.subtitle) contextHints.push(unescapeEntities(track.subtitle))

  const coreTitle = head || stripNoise(rawTitle) || rawTitle
  return {
    coreTitle,
    artists: realArtists,
    contextHints,
    modifiers,
  }
}

/** Build up to 2 crisp search queries for resolving a track in JioSaavn's catalog. */
export function buildMatchQueries(track) {
  const { coreTitle, artists, contextHints } = extractTrackQueryParts(track)
  const queries = []
  const primary = artists[0] || contextHints[0] || ''
  const combined = `${coreTitle} ${primary}`.replace(/\s+/g, ' ').trim()
  if (combined) queries.push(combined)
  const titleOnly = coreTitle.replace(/\s+/g, ' ').trim()
  if (titleOnly && !queries.some((q) => q.toLowerCase() === titleOnly.toLowerCase())) {
    queries.push(titleOnly)
  }
  return queries
}

function computeTitleSimilarity(targetTitle, candidateTitle) {
  const aNorm = normalizeText(targetTitle)
  const bNorm = normalizeText(candidateTitle)
  if (!aNorm || !bNorm) return 0
  if (aNorm === bNorm) return 1

  const aTokens = significantTokens(targetTitle)
  const bTokens = significantTokens(candidateTitle)
  if (!aTokens.length || !bTokens.length) return 0

  const aSet = new Set(aTokens)
  const bSet = new Set(bTokens)
  let shared = 0
  for (const t of aSet) {
    if (bSet.has(t)) shared += 1
  }
  if (shared === 0) return 0

  // Every significant token of the requested title appears in the studio title
  // (e.g. `"Arabic Kuthu"` ↔ `"Arabic Kuthu - Halamithi Habibo"`, `"Kesariya"` ↔ `"Kesariya (From Brahmastra)"`).
  if (shared === aSet.size) {
    const extraRatio = Math.min(1, aSet.size / bSet.size)
    return 0.84 + 0.16 * extraRatio
  }
  // Reverse containment when YouTube included subtitle words (`"Hukum Thalaivar Alappara"` ↔ `"Hukum"`).
  if (shared === bSet.size && bSet.size >= 1) {
    const extraRatio = Math.min(1, bSet.size / aSet.size)
    return 0.78 + 0.16 * extraRatio
  }

  const union = new Set([...aSet, ...bSet]).size
  return shared / union
}

/** Score a JioSaavn candidate against a source track (`0` = incompatible). */
export function scoreSaavnCandidate(sourceTrack, candidate) {
  if (!candidate?.id || !Array.isArray(candidate.downloadUrl) || !candidate.downloadUrl.length) {
    return { score: 0, titleScore: 0 }
  }

  const target = extractTrackQueryParts(sourceTrack)
  const candParts = extractTrackQueryParts(candidate)

  const titleScore = Math.max(
    computeTitleSimilarity(target.coreTitle, candParts.coreTitle),
    computeTitleSimilarity(target.coreTitle, unescapeEntities(candidate.name || candidate.title || ''))
  )

  // Hard gate: never match an unrelated song purely because artist + duration match.
  if (titleScore < 0.55) {
    return { score: 0, titleScore }
  }

  // Artist / film / album corroboration.
  const targetContextTokens = new Set(
    [...target.artists, ...target.contextHints]
      .flatMap((s) => significantTokens(s))
      .filter((t) => t.length >= 2)
  )
  const candContextTokens = new Set(
    [...candParts.artists, ...candParts.contextHints]
      .flatMap((s) => significantTokens(s))
      .filter((t) => t.length >= 2)
  )

  let contextOverlap = 0
  for (const t of targetContextTokens) {
    if (candContextTokens.has(t)) contextOverlap += 1
  }
  const hasContextExpectation = targetContextTokens.size > 0
  const contextBonus = !hasContextExpectation
    ? 0.06
    : contextOverlap >= 2
      ? 0.18
      : contextOverlap === 1
        ? 0.12
        : -0.06

  // Duration corroboration when both sides report non-zero seconds.
  const srcDur = Number(sourceTrack?.duration) || 0
  const candDur = Number(candidate?.duration) || 0
  let durationAdj = 0
  if (srcDur > 0 && candDur > 0) {
    const diff = Math.abs(srcDur - candDur)
    if (diff <= 6) durationAdj = 0.14
    else if (diff <= 20) durationAdj = 0.08
    else if (diff <= 45) durationAdj = 0.02
    else if (diff > 95) durationAdj = -0.25
  }

  // Edition guardrail: don't replace an explicit remix/cover/lofi/karaoke request
  // with an unrelated studio cut (or vice versa) unless the edition matches.
  let editionAdj = 0
  for (const mod of target.modifiers) {
    if (!candParts.modifiers.has(mod)) editionAdj -= 0.25
  }
  for (const mod of candParts.modifiers) {
    if (!target.modifiers.has(mod)) editionAdj -= 0.18
  }

  const total = Math.max(0, Math.min(1, titleScore * 0.8 + contextBonus + durationAdj + editionAdj))
  return { score: total, titleScore }
}

/** Return the best confident studio audio match (`score >= 0.68`) or `null`. */
export function matchSaavnTrack(sourceTrack, candidates, { minScore = 0.68 } = {}) {
  if (!sourceTrack || !Array.isArray(candidates) || !candidates.length) return null
  let best = null
  for (const candidate of candidates) {
    const { score, titleScore } = scoreSaavnCandidate(sourceTrack, candidate)
    if (score >= minScore && (!best || score > best.score)) {
      best = { song: candidate, score, titleScore }
    }
  }
  return best
}
