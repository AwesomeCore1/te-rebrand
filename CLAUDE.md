# Tacho (repo: te-rebrand)

An open platform for virtual trucking companies (VTCs) in Euro Truck Simulator 2 and American Truck Simulator, on TruckersMP and in singleplayer. Three parts in one monorepo:

| Part          | Path                     | What it is                                                                                                 |
| ------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Website + API | `apps/web`, `packages/*` | TanStack Start, tRPC, Prisma/Postgres, Better Auth. Same stack as Sporty-v3 (github.com/TIHLDE/sporty-v3). |
| Tracker app   | `apps/tracker`           | Tauri 2 desktop app. React UI in `src/`, Rust shell in `src-tauri/`. Lives in the system tray.             |
| Tracking core | `crates/telemetry`       | Pure Rust: game telemetry frames in, job events out. No UI, no network.                                    |

Read `docs/PLAN.md` for the full plan (features, data model, hosting), `PRODUCT.md` for who it's for, and `DESIGN.md` before any UI work.

## Commands

```bash
bun install                 # JS deps for all workspaces
bun run db:start            # Postgres in Docker
bun run db:push             # apply the Prisma schema
bun run db:seed -- --steam <SteamID64> [--vtc <ID>] [--other-vtc <ID>] [--solo]  # local test data; --clear removes it
bun run dev:web             # website on http://localhost:3001
bun run dev:tracker         # tracker app (Vite on :1420 + Tauri window, Rust hot-restarts)
bun run test:rust           # tests for crates/telemetry
bun run check               # oxlint + oxfmt
bun run check:rust          # clippy + rustfmt
bun run check-types         # TypeScript across the repo
```

The tracker needs Rust (rustup) and the Tauri prerequisites: https://tauri.app/start/prerequisites/

## Rules that hold everywhere

- **Distances are stored in km.** Miles are only a display conversion (1 mi = 1.609344 km). Never store miles.
- **Every company-owned row has `companyId`**, and every API call that touches one checks the caller's role in that company through one shared tRPC middleware. This is what keeps VTCs apart. Never check roles ad hoc in a route.
- **The tracker never decides what counts.** It sends raw finished jobs; the API validates them (TruckersMP membership, plausible speed/distance) and computes ranks and goals.
- **Shared types:** job payloads the tracker sends are defined once (Zod in TS, serde in Rust) and must match. If you change `FinishedJob` in `crates/telemetry/src/tracker.rs`, change the Zod schema too.
- **Game telemetry is Windows-only** (shared memory from the RenCloud scs-sdk-plugin). On macOS, build and test with the replay source and `crates/telemetry/tests/fixtures/*.jsonl`.
- **The plugin version is pinned:** revision 12, release V.1.12.1. The memory layout changes between plugin revisions; `crates/telemetry/src/scs.rs` holds the offsets and says how they were checked. Ship that DLL and no other.
- Use Bun, not npm or yarn.

## Design work

UI follows `DESIGN.md`. The website's look was redone on 2026-11-12 (warm, editorial, scroll-driven 3D); the Figma file (link in DESIGN.md) is now the source for content and screen structure only, not visuals. The project uses these design skills; install them in this repo if they're missing:

```bash
npx impeccable install                                   # then /impeccable init reads PRODUCT.md
npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"
npx skills@latest add emilkowalski/skills
```

- Impeccable: app screens are **Operate** mode, the landing page is **Persuade**. Its craft-floor bans apply (no eyebrow labels, no nested cards, no gradient text, no unicode icons).
- Taste Skill: for the public landing page only (site kind: software).
- Emil Kowalski's skills: motion and component feel (press states, popovers, sonner toasts).
- Playwright: after UI changes, screenshot the page at 1440, 768 and 390 px wide and look at it before calling it done.

## Next steps (in order)

Done: Discord login + Steam OpenID link (`apps/web/src/lib/steam.ts`), Prisma schema (`packages/db/prisma/schema/platform.prisma`), company-scoping middleware (`companyProcedure` in `packages/api/src/index.ts`), tracker REST API (`apps/web/src/routes/api/tracker/*`, logic in `packages/api/src/tracker.ts`) with device-code pairing and hashed device tokens, Zod payloads in `packages/telemetry-types` (Rust mirror: `crates/telemetry/src/upload.rs`, both tested against `tests/fixtures/job-upload.json`). Tracker app: linking, token + offline queue (`src-tauri/src/store.rs`), uploads and positions (`src-tauri/src/tracking.rs`), dev replay through the real pipeline. First job saved end to end via replay on 2026-11-12. Live game source: `SharedMemorySource` (`crates/telemetry/src/source.rs`, decoding in `scs.rs`, Win32 calls in `win.rs`), with TruckersMP detection (`Frame.multiplayer`); tested against a stand-in memory map, not yet against the real game. Tracker shell: tray icon with a status line, close-to-tray, single instance, Start with Windows (`src-tauri/src/tray.rs`, `shell.rs`, `autostart.rs`); finding the games through Steam and one-click plugin install, with the pinned DLL shipped as a resource (`games.rs`, `plugin.rs`, `resources/scs-telemetry`). The install is tested against temporary folders, not yet in a real game folder.

Website and API, built 2026-11-13 (logic in `packages/api/src/*.ts`, one router file per area in `packages/api/src/routers/`): company sign-up with TruckersMP ownership check (`/vtc/new`, `companies.ts`), public company page with recruitment form (`/vtc/<slug>`), company admin under `/vtc/<slug>/admin` (members, applications, ranks, goals, flagged jobs, settings), the nightly TruckersMP membership check (`membership-check.ts`, `bun run membership:check`), public leaderboards (`/leaderboards`), the live map over a WebSocket (`/map`, `live.ts`), the new-driver steps on the dashboard, public driver profiles (`/driver/<id>`), the download page (`/download`), and job pages with fines, tolls, ferries and trains (`/jobs/<id>`; the tracker reads them from the plugin, `crates/telemetry/src/scs.rs`). Discord rank roles are kept in line through `rank_roles_sync` outbox rows (`rank-roles.ts`). `Company.settings` has one schema (`company-settings.ts`); change it only through `updateCompanySettings`. Deliveries and rank-ups are written to `OutboxEvent` in the same transaction as the job (`deliveries.ts`, payloads in `outbox.ts`); the Discord bot in `apps/bot` reads them (`bun run dev:bot`, needs `DISCORD_BOT_TOKEN`).

Testing: `bun test` in a package. The API tests use their own database, `te-rebrand_test`, created on first run in the same Postgres (`packages/api/src/test-db.ts`). `bun run dev:session` prints a login cookie for scripted checks of logged-in pages; `bun src/dev-drive.ts` in `packages/db` puts the seeded drivers on the live map.

Note: ETS2/ATS road distances are map-scaled (about 1:19 / 1:20), so odometer km per real hour is far above the speedometer. Plausibility checks must account for this (see `flagReasons`).

1. Check `SharedMemorySource` against the real game: install the plugin from the tracker (the setup card on Live job, or Settings, Games), accept the game's "SDK features" notice, run `cargo run -p te-telemetry --example watch`, and do one delivery in singleplayer and one on TruckersMP. Record one with `--record` as a fixture.
2. Tracker releases: Tauri's signed updater (needs signing keys and a place to publish releases, neither exists yet) and a code-signed installer.
3. Switch the Discord bot on with a real token and check it in a real server; it has only run against a fake Discord.
4. Still open from the plan: deployment (production compose, backups; CI is in `.github/workflows/ci.yml`), a map tile source for `/map`, ownership transfer for companies, a released tracker installer for `/download` (`TRACKER_DOWNLOAD_URL`).

Convoys/events: never stored by us, and only shown for VTCs that use Tacho (verified companies with a `truckersmpVtcId`). They come from TruckersMP via `packages/truckersmp` (logic in `packages/api/src/convoys.ts`): `/events` lists them, `/events/$eventId` shows one.
