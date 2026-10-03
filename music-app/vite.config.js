import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Node gateway (server.mjs) serves the built bundle in production and owns
// /api and /dl. In dev, proxy those two through to it so the React app talks to
// exactly the same endpoints either way.
const GATEWAY = process.env.GATEWAY || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
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
