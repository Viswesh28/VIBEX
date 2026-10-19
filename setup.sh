#!/bin/bash
# Reinstall everything after a workspace restore (node_modules is never saved).
# Usage: bash setup.sh
set -e
export PATH="$HOME/.bun/bin:$PATH"
if ! command -v bun >/dev/null; then
  echo "Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
chmod +x "$HOME"/.bun/bin/* 2>/dev/null || true
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- 1. the vendored API's own runtime dependencies -----------------------
# This has to happen before the front-end is installed or built: music-app
# consumes jiosaavn-api as a "file:" dependency and mounts its controllers
# in-process (music-app/src/lib/embedded-api.js), so @hono/zod-openapi, hono,
# zod and node-forge must resolve to a single copy from here.
#
# --ignore-scripts stops the fork's `postinstall: npx simple-git-hooks` from
# overwriting this repository's .git/hooks with `bun run lint && bun run format`,
# which is meaningless at the repo root and blocks every commit without bun.
cd "$ROOT_DIR/jiosaavn-api"
bun install --production --ignore-scripts
rm -rf ~/.bun/install/cache && mkdir -p ~/.bun/install/cache

# --- 2. the front-end and gateway -----------------------------------------
cd "$ROOT_DIR/music-app"
npm ci --ignore-scripts

# --- 3. build, since the gateway serves music-app/dist --------------------
npm run build

echo
echo "Done. Start servers with:"
echo '  PORT=3001 bun run run-local.mjs   (from jiosaavn-api/)'
echo '  PORT=8000 API_TARGET=http://127.0.0.1:3001 node server.mjs   (from music-app/)'
echo "Open http://localhost:8000 (the gateway proxies all /api requests)."
echo
echo "Checks:"
echo '  npm test              offline unit + integration tests (from music-app/)'
echo '  npm run verify:mobile phone layout, 5 viewports (needs: npx playwright install chromium)'
echo '  npm run verify:ux     contrast / accessible names / tap spacing'
