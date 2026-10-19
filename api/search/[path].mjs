// Vercel's filesystem router matches this concrete nested API segment before
// the generic catch-all. The shared adapter preserves the original URL so the
// Hono app still receives `/api/search/<resource>`.
export { default } from '../[...path].mjs'
