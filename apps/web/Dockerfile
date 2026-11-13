FROM node:24-slim AS builder
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

COPY . .

# The install (Prisma client generation) and the build check the env schema
# but never connect anywhere or bake server values into the bundle; the real
# values come from the environment when the container runs. Local builds
# (docker-compose.yml) mount apps/web/.env as a BuildKit secret; without it
# (CI, infra/docker-compose.prod.yml) these placeholders are used instead.
ARG BUILD_PLACEHOLDER_ENV="DATABASE_URL=postgresql://build:build@localhost:5432/build BETTER_AUTH_SECRET=build-time-placeholder-not-a-secret-0000 BETTER_AUTH_URL=http://localhost:3001 DISCORD_CLIENT_ID=build DISCORD_CLIENT_SECRET=build"

RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local --mount=type=cache,target=/root/.bun/install/cache \
    if [ ! -s apps/web/.env.local ]; then export $BUILD_PLACEHOLDER_ENV; fi && bun install --frozen-lockfile

ENV NODE_ENV=production
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local \
    if [ ! -s apps/web/.env.local ]; then export $BUILD_PLACEHOLDER_ENV; fi && cd apps/web && bun run build
ENV DATABASE_URL=

FROM node:24-slim AS runner
# Prisma's migrate engine (the migrate service in infra/docker-compose.prod.yml) needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app /app

ENV HOST=0.0.0.0
ENV PORT=3001
EXPOSE 3001

# SSR chunks require workspace dependencies at runtime
WORKDIR /app/apps/web
CMD ["node", ".output/server/index.mjs"]
