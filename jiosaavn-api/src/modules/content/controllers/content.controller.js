import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { ContentService } from '../services/index.js'

const UPSTREAM_SYNC = {"repository":"https://github.com/sumitkolhe/jiosaavn-api.git","branch":"main","commit":"fc6bd132193d1fc71c2ab3db373e78b92884f67c","commitMessage":"fix: remove api folder for vercel deployments","commitDate":"2026-04-16T09:13:30+05:30","syncedAt":"2026-10-23T08:12:52.959Z","compiledFiles":126}

const feedQuerySchema = z.object({
  languages: z.string().optional(),
  sort: z.enum(['trending', 'plays', 'newest']).optional(),
  limit: z.string().pipe(z.coerce.number().min(1).max(60)).optional()
})

export class ContentController {
  controller
  service

  constructor() {
    this.controller = new OpenAPIHono()
    this.service = new ContentService()
  }

  initRoutes() {
    const trendingHandler = async (ctx) => {
      const { languages, sort, limit } = ctx.req.valid('query')
      const results = await this.service.getTrendingSongs({
        languages,
        sort: sort || 'trending',
        limit: limit || 20
      })
      return ctx.json({
        success: true,
        data: {
          total: results.length,
          start: 0,
          updatedAt: new Date().toISOString(),
          results
        }
      })
    }

    const newReleasesHandler = async (ctx) => {
      const { languages, limit } = ctx.req.valid('query')
      const results = await this.service.getNewReleases({
        languages,
        limit: limit || 20
      })
      return ctx.json({
        success: true,
        data: {
          total: results.length,
          start: 0,
          updatedAt: new Date().toISOString(),
          results
        }
      })
    }

    for (const routePath of ['/content/trending', '/trending']) {
      this.controller.openapi(
        createRoute({
          method: 'get',
          path: routePath,
          tags: ['Content'],
          summary: 'Retrieve live trending songs across languages',
          request: { query: feedQuerySchema },
          responses: {
            200: {
              description: 'Live trending songs with decrypted audio URLs',
              content: { 'application/json': { schema: z.any() } }
            }
          }
        }),
        trendingHandler
      )
    }

    for (const routePath of ['/content/new-releases', '/new-releases']) {
      this.controller.openapi(
        createRoute({
          method: 'get',
          path: routePath,
          tags: ['Content'],
          summary: 'Retrieve newly released playable songs across languages',
          request: { query: feedQuerySchema },
          responses: {
            200: {
              description: 'Newly released playable songs sorted by releaseDate descending',
              content: { 'application/json': { schema: z.any() } }
            }
          }
        }),
        newReleasesHandler
      )
    }

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/content/albums',
        tags: ['Content'],
        summary: 'Retrieve newly released and trending albums across languages',
        request: { query: feedQuerySchema },
        responses: {
          200: {
            description: 'Live trending and newly released albums',
            content: { 'application/json': { schema: z.any() } }
          }
        }
      }),
      async (ctx) => {
        const { languages, limit } = ctx.req.valid('query')
        const results = await this.service.getNewAlbums({
          languages,
          limit: limit || 20
        })
        return ctx.json({
          success: true,
          data: {
            total: results.length,
            start: 0,
            updatedAt: new Date().toISOString(),
            results
          }
        })
      }
    )

    for (const statusPath of ['/content/sync-status', '/health']) {
      this.controller.get(statusPath, (ctx) =>
        ctx.json({
          success: true,
          data: {
            status: 'ok',
            upstream: UPSTREAM_SYNC,
            refreshPolicy: {
              catalogTtlSeconds: 180,
              edgeSMaxAgeSeconds: 300,
              scheduledRepoSyncCron: '0 */6 * * *'
            }
          }
        })
      )
    }
  }
}
