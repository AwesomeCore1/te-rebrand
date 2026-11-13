# The Discord bot. Build from the repo root (docker compose does):
#   docker build -f apps/bot/Dockerfile -t tacho-bot .
# What is left out of the build is listed in apps/bot/Dockerfile.dockerignore.
FROM node:24-slim
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

COPY . .

# The install also generates the Prisma client (root postinstall). That step
# reads DATABASE_URL but never connects, so a placeholder is enough here; the
# real one comes from the environment when the container runs.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-time-placeholder-not-a-secret-0000 \
    BETTER_AUTH_URL=http://localhost:3001 \
    DISCORD_CLIENT_ID=build DISCORD_CLIENT_SECRET=build \
    bun install --frozen-lockfile

ENV NODE_ENV=production
WORKDIR /app/apps/bot
# No port: the bot only makes outgoing connections (Discord, Postgres, TruckersMP).
CMD ["bun", "src/main.ts"]
