/* ==========================================================================
   VIBEX service worker — app shell only
   --------------------------------------------------------------------------
   The installed app has to open instantly (and offline) with the user's
   library, playlists and settings intact. That means caching the HTML shell,
   its hashed JS/CSS and the PWA artwork.

   It deliberately never touches:
     • /api/*  — catalogue responses are live, per-user and noisy to cache
     • /dl     — downloads are big, streamed, and must not be intercepted
     • audio   — JioSaavn streams are cross-origin and short-lived

   Navigation is network-first, so a new deploy is picked up on the next
   launch; the cache is only the fallback. Hashed assets are cache-first,
   because Vite guarantees a new filename whenever the bytes change.
   ========================================================================== */

const VERSION = 'vibex-v3'
const SHELL = `${VERSION}-shell`
const ASSETS = `${VERSION}-assets`
const IMAGES = `${VERSION}-images`
const CURRENT = new Set([SHELL, ASSETS, IMAGES])

const NAV_TIMEOUT_MS = 4500
const MAX_SHELL_CHECKS = 80

const CORE = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
]

const isApi = (pathname) => pathname === '/dl' || pathname === '/api' || pathname.startsWith('/api/')
const isHashedAsset = (pathname) => pathname.startsWith('/assets/')
const isImageish = (pathname) =>
  pathname.startsWith('/icons/') ||
  pathname.startsWith('/splash/') ||
  pathname === '/manifest.webmanifest'

/** Cache the hashed files the HTML actually points at. */
async function warmShell() {
  let html
  try {
    const cached = await caches.match('/')
    html = cached ? await cached.text() : ''
  } catch {
    html = ''
  }
  if (!html) {
    try {
      const res = await fetch('/', { cache: 'reload' })
      if (res.ok) {
        const copy = res.clone()
        html = await res.text()
        const shell = await caches.open(SHELL)
        await shell.put('/', copy)
      }
    } catch {
      return
    }
  }
  const urls = new Set()
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) urls.add(match[1])
  if (!urls.size) return
  const cache = await caches.open(ASSETS)
  await Promise.allSettled(
    [...urls].map(async (url) => {
      if (await cache.match(url)) return
      const res = await fetch(url, { cache: 'reload' })
      if (res.ok) await cache.put(url, res)
    })
  )
  // Keep only the newest entries so repeated deploys don't grow forever.
  const keys = await cache.keys()
  for (const req of keys.slice(0, Math.max(0, keys.length - MAX_SHELL_CHECKS))) {
    await cache.delete(req)
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL)
      await Promise.allSettled(
        CORE.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'reload' })
            if (res.ok) await shell.put(url, res.clone())
          } catch {
            /* a missing optional asset must not abort the install */
          }
        })
      )
      await warmShell()
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.map((key) => (key.startsWith('vibex-') && !CURRENT.has(key) ? caches.delete(key) : null))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

async function fetchWithTimeout(request, ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(request, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function navigation(request) {
  const shell = await caches.open(SHELL)
  try {
    const res = await fetchWithTimeout(request, NAV_TIMEOUT_MS)
    if (res && res.ok) {
      const type = res.headers.get('content-type') || ''
      if (type.includes('text/html')) await shell.put('/', res.clone())
    }
    return res
  } catch {
    return (
      (await shell.match(request)) ||
      (await shell.match('/')) ||
      (await shell.match('/offline.html')) ||
      new Response('VIBEX is offline. Reconnect and try again.', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    )
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok) await cache.put(request, res.clone())
  return res
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  const network = fetch(request)
    .then(async (res) => {
      if (res.ok) await cache.put(request, res.clone())
      return res
    })
    .catch(() => null)
  return hit || (await network) || Response.error()
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }
  // Cross-origin audio/artwork is the browser's business, not ours.
  if (url.origin !== self.location.origin) return
  if (isApi(url.pathname)) return
  if (request.headers.has('range')) return

  if (request.mode === 'navigate') {
    event.respondWith(navigation(request))
    // Refresh the shell's hashed JS/CSS without delaying the page.
    event.waitUntil(warmShell().catch(() => {}))
    return
  }
  if (isHashedAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, ASSETS))
    return
  }
  if (isImageish(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, IMAGES))
  }
})
