// Vercel adapter for the bundled JioSaavn Hono application.
//
// The application uses the Fetch API while Vercel's Node functions receive
// IncomingMessage/ServerResponse objects, so this thin adapter keeps /api/*
// identical to the local gateway without starting a persistent HTTP server.
import app from '../jiosaavn-api/src/server.js'

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function requestHeaders(headers) {
  const out = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (value == null || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue
    out.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  return out
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return chunks.length ? Buffer.concat(chunks) : undefined
}

export default async function handler(req, res) {
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers.host || process.env.VERCEL_URL || 'localhost'
  const url = new URL(req.url || '/', `${protocol}://${host}`)
  const method = req.method || 'GET'

  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET, HEAD, POST, OPTIONS')
  res.setHeader(
    'access-control-allow-headers',
    'accept, content-type, range, x-youtube-api-key, authorization'
  )
  res.setHeader(
    'access-control-expose-headers',
    'content-disposition, content-length, content-range, accept-ranges'
  )

  if (method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  try {
    const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req)
    const response = await app.fetch(
      new Request(url, {
        method,
        headers: requestHeaders(req.headers),
        body,
      })
    )

    response.headers.forEach((value, name) => {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) res.setHeader(name, value)
    })
    res.statusCode = response.status
    if (method === 'HEAD' || !response.body) {
      res.end()
      return
    }
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    // Keep the client contract JSON-shaped even if a function-level error occurs.
    res.statusCode = 502
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify({ success: false, message: 'Music API temporarily unavailable.' }))
  }
}
