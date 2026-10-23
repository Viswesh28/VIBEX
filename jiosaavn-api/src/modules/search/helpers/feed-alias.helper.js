import { DEFAULT_FEED_LANGUAGES, SUPPORTED_LANGUAGES, parseLanguages } from '../../content/helpers/index.js'

export { DEFAULT_FEED_LANGUAGES as DEFAULT_TRENDING_LANGUAGES, SUPPORTED_LANGUAGES }

const LANGUAGE_GROUP = SUPPORTED_LANGUAGES.join('|')
const TRENDING_PATTERN = /^trending songs \d{4}$/
const NEW_PATTERN = new RegExp(`^new (${LANGUAGE_GROUP}) songs \\d{4}$`)
const HITS_PATTERN = new RegExp(`^(${LANGUAGE_GROUP}) hits \\d{4}$`)

export const resolveFeedAlias = (query, languagesParam) => {
  const normalised = String(query || '').trim().toLowerCase().replaceAll(/\s+/g, ' ')
  if (TRENDING_PATTERN.test(normalised)) {
    return { source: 'trending', languages: parseLanguages(languagesParam), sort: 'trending' }
  }
  const newest = NEW_PATTERN.exec(normalised)
  if (newest) return { source: 'new-releases', languages: [newest[1]], sort: 'newest' }
  const hits = HITS_PATTERN.exec(normalised)
  if (hits) return { source: 'trending', languages: [hits[1]], sort: 'plays' }
  return null
}
