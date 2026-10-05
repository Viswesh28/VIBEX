/**
 * The JioSaavn API, running inside the app.
 *
 * The upstream API is a Hono app with zero Node built-ins — it was written to
 * run on Cloudflare Workers, which means it's just a Request -> Response
 * function and will happily execute in a WebView. So instead of deploying it
 * and talking to it over HTTP, we mount the same controllers here and call
 * them in-process. No server, no hosting, no cold starts.
 *
 * Two things make this work on-device and nowhere else:
 *
 *   1. jiosaavn.com sends no CORS headers, so a browser would block every
 *      upstream call. Capacitor's `CapacitorHttp` patches window.fetch onto
 *      the native HTTP stack (OkHttp), which has no same-origin policy.
 *   2. The API sets a `User-Agent` header. Browsers silently drop that —
 *      it's a forbidden header name — but the native stack honours it.
 *
 * `App` from the upstream source isn't used: it pulls in the Scalar docs UI
 * and a request logger, which are pure weight in a phone bundle. We rebuild
 * the same routing (`/api` + the five controllers) without them.
 */
import { OpenAPIHono } from '@hono/zod-openapi'
import {
  AlbumController,
  ArtistController,
  SearchController,
  SongController,
} from 'jiosaavn-api/src/modules/index.js'
import { PlaylistController } from 'jiosaavn-api/src/modules/playlists/controllers/index.js'

let app = null

function build() {
  const instance = new OpenAPIHono()

  for (const route of [
    new SearchController(),
    new SongController(),
    new AlbumController(),
    new ArtistController(),
    new PlaylistController(),
  ]) {
    route.initRoutes()
    instance.route('/api', route.controller)
  }

  instance.notFound((ctx) => ctx.json({ success: false, message: 'route not found' }, 404))
  instance.onError((err, ctx) =>
    ctx.json({ success: false, message: err?.message || 'internal error' }, err?.status || 500)
  )

  return instance
}

/**
 * Handle a request without touching the network stack.
 *
 * `path` is the same path the hosted gateway would have received, e.g.
 * `/api/search/songs?query=...`, so callers don't care which mode they're in.
 * The origin is a placeholder — nothing ever dials it.
 */
export function embeddedFetch(path, init) {
  if (!app) app = build()
  return app.fetch(new Request(`http://embedded.vibex${path}`, init))
}
