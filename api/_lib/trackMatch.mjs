// ==========================================================================
// Cross-catalog studio track matcher (metadata-only, zero stream extraction).
// --------------------------------------------------------------------------
// Matches a catalog entry's `(title, artists, album, duration)` metadata
// against JioSaavn catalog candidates so tracks selected under YouTube Music
// play natively as pure `<audio>` studio tracks whenever a matching studio
// recording exists, falling back cleanly to YouTube's official IFrame player
// otherwise.
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
  'jukebox',
  'nonstop',
  'non-stop',
  'medley',
  'bgm',
  'ringtone',
  'teaser',
  'trailer',
  'glimpse',
  'reprise',
  'female',
  'male',
]

const VIDEO_NOISE_RE =
  /\b(official\s+(music\s+|lyric\s+)?(video|audio|visualizer)|lyric(al)?(\s+video|\s+song)?|video\s+song|full\s+(video|audio|song)(\s+song)?|audio\s+song|4k|8k|uhd|hd\s+video|dolby\s+atmos|mv|m\/v)\b/gi

const SUBTITLE_METADATA_RE =
  /^(song|video|album|single|ep|episode|podcast|\d+(?:[.,]\d+)?\s*[kmb]?\s*(?:plays|views|subscribers|likes))$/i

const GENERIC_LABELS = new Set([
  'unknown artist',
  'various artists',
  'song',
  'video',
  'album',
  'single',
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
  'divo music',
  'ayngaran',
])

const TITLE_STOPWORDS = new Set(['from', 'the', 'song', 'ost', 'motion', 'picture', 'soundtrack', 'original'])

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

/** True when a subtitle chip is a YouTube type/view badge rather than an artist or album name. */
export function isSubtitleMetadataChip(part) {
  return SUBTITLE_METADATA_RE.test(String(part || '').trim())
}

/** Clean YouTube channel suffixes (`"Anirudh - Topic"` → `"Anirudh"`, `"TheWeekndVEVO"` → `"The Weeknd"`). */
export function cleanChannelArtist(raw) {
  let s = unescapeEntities(raw).trim()
  if (!s || isSubtitleMetadataChip(s)) return ''
  s = s.replace(/\s*[-–—]\s*topic$/i, '').trim()
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

/**
 * Light romanization folding for Indian transliteration variants
 * (`"Manasilaayo"` ↔ `"Manasilayo"`, `"Kanimaa"` ↔ `"Kanima"`, `"Thaensudare"` ↔ `"Thensudare"`).
 */
export function phoneticFoldToken(token) {
  const t = String(token || '').toLowerCase()
  if (t.length < 4 || !/^[a-z]+$/.test(t)) return t
  return t
    .replace(/th/g, 't')
    .replace(/dh/g, 'd')
    .replace(/zh/g, 'l')
    .replace(/sh/g, 's')
    .replace(/bh/g, 'b')
    .replace(/kh/g, 'k')
    .replace(/gh/g, 'g')
    .replace(/ph/g, 'f')
    .replace(/ae/g, 'e')
    .replace(/aa/g, 'a')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/([a-z])\1+/g, '$1')
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
    .replace(/\(\s*from\s+["'“”]?([^"'”)]+)["'”)]?\s*\)/gi, ' ')
    .replace(/\[\s*from\s+["'“”]?([^"'”\]]+)["'”\]]?\s*\]/gi, ' ')
}

function stripNoise(segment) {
  return stripMovieClause(segment)
    .replace(/\([^)]*\)/g, (clause) => {
      const cleaned = clause.replace(VIDEO_NOISE_RE, '').replace(/[()\s-–—]+/g, '')
      return cleaned ? ` ${clause} ` : ' '
    })
    .replace(/\[[^\]]*\]/g, (clause) => {
      const cleaned = clause.replace(VIDEO_NOISE_RE, '').replace(/[\[\]\s-–—]+/g, '')
      return cleaned ? ` ${clause} ` : ' '
    })
    .replace(VIDEO_NOISE_RE, ' ')
    .replace(/\s*[-–—:]\s*$/g, '')
    .replace(/^\s*[-–—:]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitArtistList(raw) {
  return String(raw || '')
    .split(/,|&|\bfeat\.?\b|\bft\.?\b/i)
    .map((name) => cleanChannelArtist(name))
    .filter((name) => name && !isSubtitleMetadataChip(name))
}

function extractArtistNames(track) {
  if (!track) return []
  if (Array.isArray(track.artists)) {
    return track.artists
      .flatMap((a) => splitArtistList(typeof a === 'string' ? a : a?.name))
      .filter(Boolean)
  }
  const primary = track.artists?.primary || track.artists?.all || []
  if (Array.isArray(primary) && primary.length) {
    return primary.flatMap((a) => splitArtistList(a?.name || a)).filter(Boolean)
  }
  return []
}

/**
 * Decompose a raw YouTube / catalog track into clean search components:
 * - `coreTitle`: primary song title stripped of video tags and pipe metadata
 * - `altTitle`: secondary dash clause when both halves are song title phrases
 * - `artists`: non-label artist names
 * - `contextHints`: album / film / artist clues from pipe segments & subtitle
 * - `modifiers`: special edition tags (`remix`, `lofi`, `cover`, `live`, etc.)
 */
export function extractTrackQueryParts(track) {
  const rawTitle = unescapeEntities(track?.name ?? track?.title ?? '').trim()
  const modifiers = extractModifiers(rawTitle)

  const contextHints = []
  for (const m of rawTitle.matchAll(/from\s+["'“”]([^"'”]+)["'”]/gi)) {
    if (m[1]) contextHints.push(m[1].trim())
  }

  const pipeParts = rawTitle.split('|').map((p) => p.trim()).filter(Boolean)
  let head = pipeParts[0] || rawTitle
  for (const extra of pipeParts.slice(1)) {
    const cleaned = stripNoise(extra)
    if (cleaned && !isSubtitleMetadataChip(cleaned)) contextHints.push(cleaned)
  }

  const rawArtists = extractArtistNames(track)
  const realArtists = rawArtists.filter((a) => !GENERIC_LABELS.has(normalizeText(a)))

  let altTitle = ''
  const dashParts = head.split(/\s*[-–—]\s*/).map((p) => stripNoise(p)).filter(Boolean)
  if (dashParts.length >= 2) {
    const firstNorm = normalizeText(dashParts[0])
    const matchesKnownArtist = realArtists.some((a) => {
      const an = normalizeText(a)
      return an && (an === firstNorm || firstNorm.includes(an) || an.includes(firstNorm))
    })
    if (matchesKnownArtist) {
      head = dashParts.slice(1).join(' ')
    } else {
      head = dashParts[0]
      altTitle = dashParts.join(' ')
      for (const rest of dashParts.slice(1)) contextHints.push(rest)
    }
  } else {
    head = stripNoise(head)
  }

  const albumName =
    typeof track?.album === 'string' ? track.album : track?.album?.name || ''
  if (albumName && !isSubtitleMetadataChip(albumName)) {
    contextHints.push(unescapeEntities(albumName))
  }
  if (track?.subtitle) {
    for (const part of unescapeEntities(track.subtitle).split('•')) {
      const trimmed = part.trim()
      if (trimmed && !isSubtitleMetadataChip(trimmed) && !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(trimmed)) {
        contextHints.push(trimmed)
      }
    }
  }

  const coreTitle = head || stripNoise(rawTitle) || rawTitle
  return {
    coreTitle,
    altTitle: altTitle && altTitle !== coreTitle ? altTitle : '',
    artists: realArtists,
    contextHints,
    modifiers,
  }
}

/** Build crisp search queries for resolving a track in JioSaavn's catalog. */
export function buildMatchQueries(track) {
  const { coreTitle, altTitle, artists, contextHints } = extractTrackQueryParts(track)
  const queries = []
  const pushUnique = (q) => {
    const clean = String(q || '').replace(/\s+/g, ' ').trim()
    if (clean && !queries.some((existing) => existing.toLowerCase() === clean.toLowerCase())) {
      queries.push(clean)
    }
  }

  const primary = artists[0] || contextHints[0] || ''
  if (primary) pushUnique(`${coreTitle} ${primary}`)
  pushUnique(coreTitle)
  if (altTitle) pushUnique(altTitle)
  return queries.slice(0, 3)
}

function tokensMatch(a, b) {
  if (a === b) return 1
  if (a.length >= 4 && b.length >= 4 && phoneticFoldToken(a) === phoneticFoldToken(b)) {
    return 0.92
  }
  return 0
}

function computeTitleSimilarity(targetTitle, candidateTitle) {
  const aNorm = normalizeText(targetTitle)
  const bNorm = normalizeText(candidateTitle)
  if (!aNorm || !bNorm) return 0
  if (aNorm === bNorm) return 1

  const aTokens = significantTokens(targetTitle)
  const bTokens = significantTokens(candidateTitle)
  if (!aTokens.length || !bTokens.length) return 0

  const aUnique = [...new Set(aTokens)]
  const bUnique = [...new Set(bTokens)]
  const leadingMatches = tokensMatch(aUnique[0], bUnique[0]) >= 0.9

  let matchedWeight = 0
  for (const at of aUnique) {
    let bestToken = 0
    for (const bt of bUnique) {
      const w = tokensMatch(at, bt)
      if (w > bestToken) bestToken = w
    }
    matchedWeight += bestToken
  }
  if (matchedWeight === 0) return 0

  if (matchedWeight >= aUnique.length * 0.92 && leadingMatches) {
    const extraRatio = Math.min(1, aUnique.length / bUnique.length)
    return 0.84 + 0.16 * extraRatio * (matchedWeight / aUnique.length)
  }

  let reverseWeight = 0
  for (const bt of bUnique) {
    let bestToken = 0
    for (const at of aUnique) {
      const w = tokensMatch(bt, at)
      if (w > bestToken) bestToken = w
    }
    reverseWeight += bestToken
  }
  if (reverseWeight >= bUnique.length * 0.92 && bUnique.length >= 1 && leadingMatches) {
    const extraRatio = Math.min(1, bUnique.length / aUnique.length)
    return 0.8 + 0.16 * extraRatio * (reverseWeight / bUnique.length)
  }

  const unionApprox = aUnique.length + bUnique.length - matchedWeight
  return unionApprox > 0 ? matchedWeight / unionApprox : 0
}

/** Score a JioSaavn candidate against a source track (`0` = incompatible). */
export function scoreSaavnCandidate(sourceTrack, candidate) {
  if (!candidate?.id || !Array.isArray(candidate.downloadUrl) || !candidate.downloadUrl.length) {
    return { score: 0, titleScore: 0 }
  }

  // Never match long-form mixes, jukeboxes, or concerts (>= 10 min) against single studio cuts.
  const srcDur = Number(sourceTrack?.duration) || 0
  const candDur = Number(candidate?.duration) || 0
  if (srcDur >= 600 && (!candDur || Math.abs(srcDur - candDur) > 30)) {
    return { score: 0, titleScore: 0 }
  }
  // Hard gate on runtime drift whenever both sides report non-zero duration:
  // prevents extended scenes, trailers, or same-album tracks from swapping audio.
  if (srcDur > 0 && candDur > 0 && Math.abs(srcDur - candDur) > 35) {
    return { score: 0, titleScore: 0 }
  }

  const target = extractTrackQueryParts(sourceTrack)
  const candParts = extractTrackQueryParts(candidate)
  const candRawName = unescapeEntities(candidate.name || candidate.title || '')

  const coreSim = Math.max(
    computeTitleSimilarity(target.coreTitle, candParts.coreTitle),
    computeTitleSimilarity(target.coreTitle, candRawName)
  )
  // Only consult `altTitle` when `coreTitle` itself already matches the song title
  // (never allowing `- Movie Name` in `altTitle` to match another track from that movie).
  const titleScore =
    coreSim >= 0.6 && target.altTitle
      ? Math.max(
          coreSim,
          computeTitleSimilarity(target.altTitle, candParts.coreTitle),
          computeTitleSimilarity(target.altTitle, candRawName)
        )
      : coreSim

  // Hard gate: never match an unrelated song purely because artist + duration match.
  if (titleScore < 0.72) {
    return { score: 0, titleScore }
  }

  // Strict edition guardrail: never swap a remix / lofi / cover / live / unplugged /
  // jukebox / reprise / female / male version with a plain studio cut (or vice versa).
  for (const mod of target.modifiers) {
    if (!candParts.modifiers.has(mod)) return { score: 0, titleScore }
  }
  for (const mod of candParts.modifiers) {
    if (!target.modifiers.has(mod)) return { score: 0, titleScore }
  }

  // Artist / film / album corroboration (neutral `0` when a label channel carries no singer name).
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
  const contextBonus = contextOverlap >= 2 ? 0.16 : contextOverlap === 1 ? 0.11 : 0

  let durationAdj = 0
  if (srcDur > 0 && candDur > 0) {
    const diff = Math.abs(srcDur - candDur)
    if (diff <= 8) durationAdj = 0.14
    else if (diff <= 20) durationAdj = 0.08
    else durationAdj = 0.02
  }

  const total = Math.max(0, Math.min(1, titleScore * 0.85 + contextBonus + durationAdj))
  return { score: total, titleScore }
}

/** Return the best verified identical studio audio match (`score >= 0.72`) or `null`. */
export function matchSaavnTrack(sourceTrack, candidates, { minScore = 0.72 } = {}) {
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
