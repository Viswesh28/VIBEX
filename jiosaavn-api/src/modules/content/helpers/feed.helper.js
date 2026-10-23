export const SUPPORTED_LANGUAGES = [
  'english',
  'hindi',
  'tamil',
  'telugu',
  'malayalam',
  'kannada',
  'punjabi',
  'bengali',
  'marathi',
  'gujarati',
  'bhojpuri',
  'urdu'
]

export const DEFAULT_FEED_LANGUAGES = ['tamil', 'hindi', 'english', 'telugu', 'malayalam']

export const parseLanguages = (languagesParam, fallback = DEFAULT_FEED_LANGUAGES) => {
  const requested = String(languagesParam || '')
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter((l) => SUPPORTED_LANGUAGES.includes(l))
  return requested.length ? [...new Set(requested)] : [...fallback]
}

export const sortFeedSongs = (songs, sort = 'trending') => {
  const ordered = [...songs]
  if (sort === 'trending') return ordered
  if (sort === 'newest') {
    return ordered.sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
  }
  return ordered.sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0))
}

export const interleaveFeedItems = (lists, limit = 20) => {
  const seen = new Set()
  const merged = []
  const longest = Math.max(0, ...lists.map((list) => list.length))
  for (let index = 0; index < longest && merged.length < limit; index++) {
    for (const list of lists) {
      if (merged.length >= limit) break
      const item = list[index]
      if (!item || !item.id || seen.has(item.id)) continue
      seen.add(item.id)
      merged.push(item)
    }
  }
  return merged
}

export const interleaveFeedSongs = interleaveFeedItems
