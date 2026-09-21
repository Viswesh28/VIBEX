#!/bin/bash
# Starts the JioSaavn API + the VIBEX UI gateway together.
set -e
API_PORT="${API_PORT:-3001}"
PORT="${PORT:-8000}"

echo "Starting JioSaavn API on :$API_PORT ..."
cd /app/jiosaavn-api
PORT="$API_PORT" bun run run-local.ts &
API_PID=$!

echo "Waiting for API ..."
for _ in $(seq 1 40); do
  if curl -sf -m 2 "http://127.0.0.1:$API_PORT/api/search/songs?query=test&limit=1" >/dev/null; then
    echo "API is up."
    break
  fi
  sleep 1
done

cleanup() { kill "$API_PID" 2>/dev/null || true; }
trap cleanup EXIT TERM INT

echo "Starting VIBEX UI gateway on :$PORT ..."
cd /app/music-app
PORT="$PORT" API_TARGET="http://127.0.0.1:$API_PORT" exec node server.mjs
