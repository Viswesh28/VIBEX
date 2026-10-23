import { userAgents } from '../constants/index.js'

const pickUserAgent = () => userAgents[Math.floor(Math.random() * userAgents.length)]

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
    // Rotate User-Agent once when JioSaavn's edge rate-limits a single request.
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
  return { data, ok: Boolean(data), status: response.status }
}
