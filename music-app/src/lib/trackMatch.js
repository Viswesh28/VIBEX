// Re-export the shared pure track matcher so client resolvers, Vitest specs,
// and serverless API routes share a single source of truth.
export * from '../../../api/_lib/trackMatch.mjs'
