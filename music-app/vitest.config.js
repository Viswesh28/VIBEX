import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Deliberately a separate file from vite.config.js: that one is the build
// config, and mixing a jsdom test environment into it changes what the browser
// bundle gets. The two `resolve` options are load-bearing for the specs that
// touch the embedded API, so they are repeated here — see the comments in
// vite.config.js for why each one exists.
const apiHono = fileURLToPath(
  new URL('../jiosaavn-api/node_modules/@hono/zod-openapi', import.meta.url)
)

export default defineConfig({
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
    alias: { '@hono/zod-openapi': apiHono },
  },
  test: {
    // jsdom by default — most specs touch the DOM (decodeHtml, contexts,
    // components). The few pure ones opt back out with `// @vitest-environment node`.
    environment: 'jsdom',
    include: ['test/**/*.spec.js', 'test/**/*.spec.jsx'],
    setupFiles: ['./test/setup.js'],
    globals: true,
    restoreMocks: true,
  },
})
