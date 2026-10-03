// Same-origin gateway to the local jiosaavn-api service.
const API_BASE = '/api'

export async function api(path) {
  let response
  try {
    response = await fetch(API_BASE + path, { headers: { accept: 'application/json' } })
  } catch {
    throw new Error('Cannot reach the local API. Start both services and open the UI gateway.')
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
  return payload.data
}

/** One cheap query to decide whether to show the app or the "API offline" state. */
export async function probeApi() {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 8000)
  try {
    const response = await fetch(`${API_BASE}/search/songs?query=test&limit=1`, {
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
