/**
 * The JioSaavn API, running inside the app.
 *
 * The upstream API (`https://github.com/sumitkolhe/jiosaavn-api.git`) is a Hono
 * app with zero Node built-ins — it runs identically on Vercel Fluid Compute
 * serverless functions and in-process inside the Capacitor native build.
 */
import { OpenAPIHono } from '@hono/zod-openapi'
import {
  AlbumController,
  ArtistController,
  ContentController,
  PlaylistController,
  SearchController,
  SongController,
} from 'jiosaavn-api/src/modules/index.js'

let app = null

function build() {
  const instance = new OpenAPIHono()

  for (const route of [
    new SearchController(),
    new SongController(),
    new AlbumController(),
    new ArtistController(),
    new PlaylistController(),
    new ContentController(),
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
 * `/api/search/songs?query=...` or `/api/content/new-releases?languages=...`.
 */
export function embeddedFetch(path, init) {
  if (!app) app = build()
  return app.fetch(new Request(`http://embedded.vibex${path}`, init))
}
