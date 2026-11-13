# Tacho

Job tracker and company hub for virtual trucking companies in ETS2 and ATS.

- `apps/web`: website and API (TanStack Start, tRPC, Prisma, Better Auth)
- `apps/tracker`: desktop tracker (Tauri 2, React + Rust)
- `crates/telemetry`: Rust tracking core with replay tests

## Getting started

Requirements: Bun, Docker, Rust (rustup) and the Tauri prerequisites (https://tauri.app/start/prerequisites/).

```bash
bun install
bun run db:start && bun run db:migrate
bun run dev:web        # http://localhost:3001
bun run dev:tracker    # tracker window
bun run test:rust
```

`apps/web/.env` holds local secrets and is git-ignored; `apps/web/.env.schema` documents the variables.

Production: `docs/DEPLOY.md`. See `CLAUDE.md` for conventions, `docs/PLAN.md` for the plan and `DESIGN.md` for the design system.
