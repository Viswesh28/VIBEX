// Talks to the JioSaavn API — over HTTP on the web, in-process on Android.
//
// On the web the gateway serves the app and proxies /api, so a relative fetch
// is right. In the native app there is no gateway at all: the same API runs
// inside the bundle (see embedded-api.js) and we call it directly. Callers
// below this line can't tell the difference.
import { apiUrl, isNative } from './config.js'

// The embedded API is ~145 kB gzipped and useless in a browser (CORS), so it
// is a dynamic import — web visitors never download the chunk.
let embedded = null

export async function apiFetch(path, init) {
  if (isNative()) {
    if (!embedded) embedded = import('./embedded-api.js')
    const { embeddedFetch } = await embedded
    // The embedded router mounts its controllers under /api, exactly like the
    // hosted one — apiUrl() adds the same prefix on the web.
    return embeddedFetch(`/api${path}`, init)
  }
  return fetch(apiUrl(path), init)
}

export async function api(path, init = {}) {
  let response
  try {
    response = await apiFetch(path, { ...init, headers: { accept: 'application/json', ...init.headers } })
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
  return payload.data
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
