import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// The Node gateway (server.mjs) serves the built bundle in production and owns
// /api and /dl. In dev, proxy those two through to it so the React app talks to
// exactly the same endpoints either way.
const GATEWAY = process.env.GATEWAY || 'http://127.0.0.1:8000'

// The Android build mounts the vendored API in-process (src/lib/embedded-api.js),
// which means two packages want to provide @hono/zod-openapi: this one, because
// it imports `OpenAPIHono` directly, and jiosaavn-api/, whose controllers are
// built on it. They install as two separate copies at the same version, and
// that is not harmless — a sub-app built on copy A and mounted into an app from
// copy B silently loses its onError handler, so an upstream failure surfaces as
// Hono's plain-text "Internal Server Error" instead of the JSON envelope the
// client parses. Pinning the specifier to the API's own copy keeps exactly one
// instance, which also de-duplicates Hono and Zod out of the bundle.
const apiHono = fileURLToPath(
  new URL('../jiosaavn-api/node_modules/@hono/zod-openapi', import.meta.url)
)

export default defineConfig({
  plugins: [react()],
  resolve: {
    // `jiosaavn-api` is consumed as a `file:` dependency, so npm installs it as
    // a symlink to ../jiosaavn-api. Vite resolves symlinks to their real path by
    // default, which moves the importer outside this tree — and Node module
    // resolution then walks up from ../jiosaavn-api/ instead of finding what npm
    // hoisted into music-app/node_modules. Keeping the symlinked path is what
    // lets the build see a single, consistent module graph.
    preserveSymlinks: true,
    alias: { '@hono/zod-openapi': apiHono },
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': { target: GATEWAY, changeOrigin: true },
      '/dl': { target: GATEWAY, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
})
