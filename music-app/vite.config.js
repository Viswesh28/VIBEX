import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const GATEWAY = process.env.GATEWAY || 'http://127.0.0.1:8000'

const apiHono = fileURLToPath(
  new URL('../jiosaavn-api/node_modules/@hono/zod-openapi', import.meta.url)
)

export default defineConfig({
  plugins: [react()],
  resolve: {
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
    target: 'es2022',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/scheduler/')
            ) {
              return 'vendor-react'
            }
            if (id.includes('/node-forge/')) {
              return 'vendor-crypto'
            }
            if (
              id.includes('/hono/') ||
              id.includes('/@hono/') ||
              id.includes('/zod/') ||
              id.includes('/@asteasolutions/') ||
              id.includes('/openapi3-ts/')
            ) {
              return 'vendor-api-core'
            }
          }
          return undefined
        },
      },
    },
  },
})
