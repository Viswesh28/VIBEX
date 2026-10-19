import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Node gateway (server.mjs) serves the built bundle in production and owns
// /api and /dl. In dev, proxy those two through to it so the React app talks to
// exactly the same endpoints either way.
const GATEWAY = process.env.GATEWAY || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // `jiosaavn-api` is consumed as a `file:` dependency, so npm installs it as
    // a symlink to ../jiosaavn-api. Vite resolves symlinks to their real path by
    // default, which moves the importer outside this tree — and Node module
    // resolution then walks up from ../jiosaavn-api/, finding none of the deps
    // npm hoisted into music-app/node_modules (hono, @hono/zod-openapi, zod,
    // node-forge). The Android build bundles that API in-process via
    // src/lib/embedded-api.js, so the build fails without this.
    preserveSymlinks: true,
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
