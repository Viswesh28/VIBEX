// Node runner, for hosts that don't offer Bun (Render/Fly/Railway free tiers).
// Hono is runtime-agnostic and @hono/node-server is already a dependency, so
// this is the same app as run-local.mjs with a different server binding.
import { serve } from '@hono/node-server'
import app from './src/server.js'

const port = Number(process.env.PORT || 3001)

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' })

// eslint-disable-next-line no-console
console.log(`JioSaavn API listening on http://0.0.0.0:${port}`)
