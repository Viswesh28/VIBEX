/**
 * URL Routing, Deep-Link Parsing & Native Web Share Helpers (`UIContext` + `App`).
 *
 * Uses query-parameter routes (`?v=...`) so every deep link opens cleanly from
 * static CDN edges, installed PWAs, WhatsApp/Discord previews, and Android
 * WebViews without 404s, while also recognizing clean `/album/:id`,
 * `/playlist/:id`, and `/artist/:id` pathnames.
 */

export function parseRouteFromLocation(loc = typeof window !== 'undefined' ? window.location : null) {
  if (!loc) return { view: { kind: 'feed' }, playTrackId: null, seekSec: 0 }
  try {
    const params = new URLSearchParams(loc.search || '')
    const playTrackId = params.get('play') || null
    const seekSec = Math.max(0, Number(params.get('t')) || 0)

    const pathname = String(loc.pathname || '/')
    const pathMatch = /^\/(album|playlist|artist)\/([^/?#]+)/i.exec(pathname)
    if (pathMatch) {
      const kindType = pathMatch[1].toLowerCase()
      const id = decodeURIComponent(pathMatch[2])
      if (kindType === 'artist') return { view: { kind: 'artist', id }, playTrackId, seekSec }
      return { view: { kind: 'detail', type: kindType, id }, playTrackId, seekSec }
    }

    const v = params.get('v')
    if (v === 'search') {
      return {
        view: {
          kind: 'search',
          query: params.get('q') || 'anirudh hits',
          tab: params.get('tab') || 'songs',
        },
        playTrackId,
        seekSec,
      }
    }
    if ((v === 'album' || v === 'playlist') && params.get('id')) {
      return { view: { kind: 'detail', type: v, id: params.get('id') }, playTrackId, seekSec }
    }
    if (v === 'detail' && params.get('id')) {
      return {
        view: { kind: 'detail', type: params.get('type') || 'playlist', id: params.get('id') },
        playTrackId,
        seekSec,
      }
    }
    if (v === 'artist' && params.get('id')) {
      return { view: { kind: 'artist', id: params.get('id') }, playTrackId, seekSec }
    }
    if (v === 'myplaylist' && params.get('id')) {
      return { view: { kind: 'myplaylist', id: params.get('id') }, playTrackId, seekSec }
    }
    if (v === 'library' || v === 'taste' || v === 'stats') {
      return { view: { kind: v }, playTrackId, seekSec }
    }
    return { view: { kind: 'feed' }, playTrackId, seekSec }
  } catch {
    return { view: { kind: 'feed' }, playTrackId: null, seekSec: 0 }
  }
}

export function buildPathForView(view) {
  if (!view || view.kind === 'feed') return '/'
  const p = new URLSearchParams()
  if (view.kind === 'search') {
    p.set('v', 'search')
    if (view.query) p.set('q', view.query)
    if (view.tab && view.tab !== 'songs') p.set('tab', view.tab)
    return `/?${p.toString()}`
  }
  if (view.kind === 'detail') {
    p.set('v', view.type || 'playlist')
    p.set('id', view.id)
    return `/?${p.toString()}`
  }
  if (view.kind === 'artist') {
    p.set('v', 'artist')
    p.set('id', view.id)
    return `/?${p.toString()}`
  }
  if (view.kind === 'myplaylist') {
    p.set('v', 'myplaylist')
    p.set('id', view.id)
    return `/?${p.toString()}`
  }
  if (view.kind === 'library' || view.kind === 'taste' || view.kind === 'stats') {
    p.set('v', view.kind)
    return `/?${p.toString()}`
  }
  return '/'
}

export function buildShareUrlForView(view, origin = typeof window !== 'undefined' ? window.location.origin : '') {
  return `${origin}${buildPathForView(view)}`
}

export function buildTrackShareUrl(
  song,
  currentSec = 0,
  origin = typeof window !== 'undefined' ? window.location.origin : ''
) {
  if (!song?.id) return origin || '/'
  const p = new URLSearchParams({ play: song.id })
  const sec = Math.floor(Number(currentSec) || 0)
  if (sec >= 3) p.set('t', String(sec))
  return `${origin}/?${p.toString()}`
}

export function buildShareUrl(
  pathOrUrl = '/',
  origin = typeof window !== 'undefined' ? window.location.origin : ''
) {
  const s = String(pathOrUrl || '/')
  if (/^https?:\/\//i.test(s)) return s
  return `${origin}${s.startsWith('/') ? '' : '/'}${s}`
}

export async function shareVibexLink({ title, text, pathOrUrl = '/' }) {
  const url = buildShareUrl(pathOrUrl)
  const res = await shareOrCopyUrl({ title, text, url })
  return {
    shared: res === 'shared',
    copied: res === 'copied',
    url,
  }
}

export async function shareOrCopyUrl({ title, text, url }) {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url })
      return 'shared'
    } catch {
      /* user dismissed native share or unsupported in desktop context */
    }
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url)
    return 'copied'
  }
  return 'url:' + url
}
