# VIBEX — UI gateway + JioSaavn API in a single container.
# Hosts (Render/Railway/Fly) inject $PORT; the gateway listens on it
# and proxies /api/* to the internal API on $API_PORT.
FROM node:20-slim

# bun (runs the JioSaavn API backend) + curl (startup health check)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && curl -fsSL https://bun.sh/install | bash \
  && rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app

# API dependencies first (better layer caching)
COPY jiosaavn-api/package.json jiosaavn-api/bun.lockb* jiosaavn-api/
RUN cd jiosaavn-api && bun install --production

# App code
COPY jiosaavn-api/ jiosaavn-api/
COPY music-app/ music-app/
COPY start.sh ./
RUN chmod +x start.sh

ENV PORT=8000 API_PORT=3001
EXPOSE 8000
CMD ["./start.sh"]
