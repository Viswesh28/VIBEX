import { userAgents } from '../constants/index.js'

const pickUserAgent = () => userAgents[Math.floor(Math.random() * userAgents.length)]

const UPSTREAM_CACHE_TTL_MS = 90_000
const UPSTREAM_CACHE_MAX = 250
const upstreamCache = new Map()
const upstreamInflight = new Map()

export const useFetch = async ({ endpoint, params, context, cookie }) => {
  const url = new URL('https://www.jiosaavn.com/api.php')
  url.searchParams.append('__call', endpoint.toString())
  url.searchParams.append('_format', 'json')
  url.searchParams.append('_marker', '0')
  url.searchParams.append('api_version', '4')
  url.searchParams.append('ctx', context || 'web6dot0')
  Object.keys(params || {}).forEach((key) => {
    if (params[key] !== undefined && params[key] !== null) {
      url.searchParams.append(key, String(params[key]))
    }
  })

  const currentFetchRef = globalThis.fetch
  const cacheKey = `${url.toString()}::${cookie || ''}`
  const cached = upstreamCache.get(cacheKey)
  if (cached && cached.fetchRef === currentFetchRef && Date.now() - cached.at <= UPSTREAM_CACHE_TTL_MS) {
    return cached.value
  }

  const inflight = upstreamInflight.get(cacheKey)
  if (inflight && inflight.fetchRef === currentFetchRef) {
    return inflight.promise
  }

  const run = (async () => {
    const headers = {
      Accept: 'application/json',
      'User-Agent': pickUserAgent(),
      ...(cookie ? { Cookie: cookie } : {})
    }

    let response = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(15000)
    })

    if (response && !response.ok && (response.status === 403 || response.status === 429 || response.status >= 500)) {
      try {
        const retryHeaders = { ...headers, 'User-Agent': pickUserAgent() }
        const retryResponse = await fetch(url.toString(), {
          headers: retryHeaders,
          signal: AbortSignal.timeout(15000)
        })
        if (retryResponse) response = retryResponse
      } catch {
        // Keep original response so error handling stays deterministic.
      }
    }

    if (!response?.ok) {
      return { data: null, ok: false, status: response?.status || 502 }
    }

    const data = await response.json().catch(() => null)
    const result = { data, ok: Boolean(data), status: response.status }
    if (result.ok) {
      if (upstreamCache.has(cacheKey)) upstreamCache.delete(cacheKey)
      upstreamCache.set(cacheKey, { value: result, at: Date.now(), fetchRef: currentFetchRef })
      if (upstreamCache.size > UPSTREAM_CACHE_MAX) {
        const oldest = upstreamCache.keys().next().value
        if (oldest !== undefined) upstreamCache.delete(oldest)
      }
    }
    return result
  })().finally(() => {
    const cur = upstreamInflight.get(cacheKey)
    if (cur?.promise === run) upstreamInflight.delete(cacheKey)
  })

  upstreamInflight.set(cacheKey, { promise: run, fetchRef: currentFetchRef })
  return run
}
