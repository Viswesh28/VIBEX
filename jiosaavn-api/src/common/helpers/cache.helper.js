const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const STALE_IF_ERROR = `stale-if-error=${7 * DAY}`

const cacheable = (maxAge, sMaxAge, revalidate) =>
  `public, max-age=${maxAge}, s-maxage=${sMaxAge}, stale-while-revalidate=${revalidate}, ${STALE_IF_ERROR}`

const RULES = [
  [/^\/api\/(content|trending|new-releases|modules|charts)(\/|$)/, cacheable(3 * MINUTE, 5 * MINUTE, 15 * MINUTE)],
  [/^\/api\/songs\/[^/]+\/suggestions\/?$/, cacheable(5 * MINUTE, 10 * MINUTE, 30 * MINUTE)],
  [/^\/api\/search(\/|$)/, cacheable(3 * MINUTE, 5 * MINUTE, 15 * MINUTE)],
  [/^\/api\/(songs|artists|albums|playlists)(\/|$)/, cacheable(15 * MINUTE, 30 * MINUTE, 2 * HOUR)]
]

export const cacheControlFor = (pathname) => {
  for (const [pattern, value] of RULES) {
    if (pattern.test(pathname)) return value
  }
  return 'no-store'
}
