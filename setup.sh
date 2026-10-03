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
cd "$ROOT_DIR/jiosaavn-api"
bun install --production
rm -rf ~/.bun/install/cache && mkdir -p ~/.bun/install/cache

# Front-end: install and build, since the gateway serves music-app/dist.
cd "$ROOT_DIR/music-app"
npm install
npm run build

echo "Done. Start servers with:"
echo '  PORT=3001 bun run run-local.mjs   (from jiosaavn-api/)'
echo '  PORT=8000 API_TARGET=http://127.0.0.1:3001 node server.mjs   (from music-app/)'
echo 'Open http://localhost:8000 (the gateway proxies all /api requests).'
