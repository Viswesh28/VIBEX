// Talks to the JioSaavn API — over HTTP on the web, in-process on Android,
// with in-flight request deduplication and bounded stale-while-revalidate RAM
// caching so tab switches, back-navigation, and prefetched detail pages render
// in 0ms without redundant network waterfalls.
import { apiUrl, isNative } from './config.js'
import { store } from './storage.js'

let embedded = null

const FRESH_TTL_MS = 60_000
const STALE_TTL_MS = 240_000
const MAX_CACHE_ENTRIES = 120

const responseCache = new Map()
const inflightRequests = new Map()

function buildEffectiveRequest(path) {
  const headers = { accept: 'application/json' }
  let effectivePath = path
  let cacheKey = path
  if (typeof path === 'string' && path.startsWith('/ytmusic')) {
    const customYtKey = String(store.get('svYtApiKey', '') || '').trim()
    if (customYtKey) {
      headers['x-youtube-api-key'] = customYtKey
      cacheKey = `${path}::${customYtKey}`
    }
    effectivePath = `${path}${path.includes('?') ? '&' : '?'}v=9`
  }
  return { effectivePath, headers, cacheKey }
}

function storeCachedEntry(key, data, fetchRef) {
  if (responseCache.has(key)) responseCache.delete(key)
  responseCache.set(key, { data, at: Date.now(), fetchRef })
  if (responseCache.size > MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next().value
    if (oldest !== undefined) responseCache.delete(oldest)
  }
}

export function clearApiCache() {
  responseCache.clear()
  inflightRequests.clear()
}

export async function apiFetch(path, init) {
  if (isNative()) {
    if (!embedded) embedded = import('./embedded-api.js')
    const { embeddedFetch } = await embedded
    return embeddedFetch(`/api${path}`, init)
  }
  return fetch(apiUrl(path), init)
}

async function fetchFreshJson(effectivePath, headers, cacheKey, fetchRef) {
  let response
  try {
    response = await apiFetch(effectivePath, { headers })
  } catch {
    throw new Error('Cannot reach the music API. Check your connection and try again.')
  }
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('The API returned an invalid response.')
  }
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.message || `API request failed (${response.status})`)
  }
  storeCachedEntry(cacheKey, payload.data, fetchRef)
  return payload.data
}

export async function api(path, opts = {}) {
  const currentFetchRef = globalThis.fetch
  const { effectivePath, headers, cacheKey } = buildEffectiveRequest(path)

  if (!opts.bypassCache) {
    const cached = responseCache.get(cacheKey)
    if (cached && cached.fetchRef === currentFetchRef) {
      const age = Date.now() - cached.at
      if (age <= FRESH_TTL_MS) {
        return cached.data
      }
      if (age <= STALE_TTL_MS) {
        if (!inflightRequests.has(cacheKey)) {
          const bg = fetchFreshJson(effectivePath, headers, cacheKey, currentFetchRef)
            .catch(() => cached.data)
            .finally(() => {
              const cur = inflightRequests.get(cacheKey)
              if (cur?.promise === bg) inflightRequests.delete(cacheKey)
            })
          inflightRequests.set(cacheKey, { promise: bg, fetchRef: currentFetchRef })
        }
        return cached.data
      }
      responseCache.delete(cacheKey)
    }
  }

  const existing = inflightRequests.get(cacheKey)
  if (existing && existing.fetchRef === currentFetchRef) {
    return existing.promise
  }

  const promise = fetchFreshJson(effectivePath, headers, cacheKey, currentFetchRef).finally(() => {
    const cur = inflightRequests.get(cacheKey)
    if (cur?.promise === promise) inflightRequests.delete(cacheKey)
  })
  inflightRequests.set(cacheKey, { promise, fetchRef: currentFetchRef })
  return promise
}

/** Fire-and-forget warm-up on pointer hover / keyboard focus for 0ms navigation. */
export function prefetchApi(path) {
  if (!path || typeof path !== 'string') return
  api(path).catch(() => {})
}

/** One cheap query to decide whether to show the app or the "API offline" state. */
export async function probeApi() {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 8000)
  try {
    const response = await apiFetch('/search/songs?query=test&limit=1', {
      signal: ctl.signal,
      headers: { accept: 'application/json' },
    })
    const payload = await response.json().catch(() => null)
    return response.ok && payload?.success === true && Array.isArray(payload.data?.results)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
