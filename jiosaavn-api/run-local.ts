// Local runner: binds 0.0.0.0 so the sandbox preview proxy can reach it.
import app from './src/server'

const port = Number(process.env.PORT || 3001)

Bun.serve({
  fetch: app.fetch,
  port,
  hostname: '0.0.0.0',
})

// eslint-disable-next-line no-console
console.log(`JioSaavn API listening on http://0.0.0.0:${port}`)
