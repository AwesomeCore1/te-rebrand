# VTC Platform – Plan & Requirements

Exported from the planning doc on 2026-11-12: https://claude.ai/artifact/TA3gr386Whw5yJm4Nh732f
Keep this file in sync when decisions change.

## Summary

An **open platform for any virtual trucking company**, not just ours: a website where drivers track their jobs and VTCs run their company, plus a small **desktop tracker app** every driver runs while playing. The tracker reads live data from ETS2 or ATS through SCS's official telemetry SDK and sends finished jobs to our API. Our own VTC is the first company on the platform. The website uses the same stack as Sporty-v3.

- One codebase for both games: the SDK is the same in ETS2 and ATS and reports which game is running.
- Works on TruckersMP and in singleplayer: the plugin runs inside the game client.
- All distances are stored in kilometres and shown as miles where the driver or game (ATS) calls for it.

## One platform for every VTC

- **Drivers without a VTC** can sign up, link Steam and track jobs on their own profile.
- **Creating a company:** an owner registers with the TruckersMP VTC ID; we check through the TruckersMP API that they own or manage that VTC.
- **Joining:** a driver applies or is invited; we check through TruckersMP that they are a member. One active company per driver (TruckersMP allows one VTC per player).
- **Roles per company:** owner, manager, driver. Managers approve members, review jobs, run events, ranks and goals for their own company only.
- **Company page:** public page (`/vtc/<slug>`) with logo, stats, leaderboard and recruitment form.
- Everything company-specific (ranks, events, goals, Discord settings) belongs to one company.

## How it works

```
Game (ETS2/ATS) -> RenCloud telemetry plugin (DLL, shared memory)
  -> Tracker app (Tauri; crates/telemetry turns frames into job events)
  -> HTTPS: POST /api/tracker/jobs, /api/tracker/position
  -> API (TanStack Start + tRPC/REST) -> PostgreSQL
  -> Website (leaderboards, profiles, map) and Discord bot
API -> TruckersMP API (membership checks)
Discord -> login (OAuth)
```

## Repo layout

| Path                          | What                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `apps/web`                    | TanStack Start website + API routes (tRPC for the site, REST under `/api/tracker/*` for the app) |
| `apps/tracker`                | Tauri 2 tracker (React UI + `src-tauri` Rust shell)                                              |
| `crates/telemetry`            | Rust tracking core: frames in, job events out; replay fixtures                                   |
| `packages/api`                | tRPC routers and context                                                                         |
| `packages/auth`               | Better Auth (Discord login, Steam link)                                                          |
| `packages/db`                 | Prisma schema, migrations, client                                                                |
| `packages/ui`                 | shadcn/ui components and theme, shared by web and tracker                                        |
| `packages/config`             | Shared TypeScript config                                                                         |
| planned `packages/truckersmp` | TruckersMP API client (official `@truckersmp/api-types`)                                         |
| planned `apps/bot`            | Discord bot (discord.js)                                                                         |

## Tracker app

Tauri 2, tracking written in Rust, running from the system tray. The React window opens only when the driver clicks the tray icon; while driving only the Rust part runs.

1. On first start it finds the ETS2 and ATS install folders and copies the RenCloud scs-sdk-plugin DLL into each game's `bin/win_x64/plugins`.
2. The driver logs in once with Discord; the app stores a device token.
3. While a game runs, it reads shared memory a few times per second and tracks the current job.
4. On a delivered or cancelled job event it sends one job record to `/api/tracker/jobs`.
5. While driving it sends position, speed and server every 5 seconds for the live map. Offline: jobs queue locally and send later.
6. Updates ship through Tauri's signed updater (GitHub Releases + `latest.json`).

## Data model

Distance is always stored as km.

| Table                          | Key fields                                                                                                                                                                                                                                 | Purpose                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `User` / `Session` / `Account` | Better Auth defaults                                                                                                                                                                                                                       | Discord login, linked Steam account                            |
| `Driver`                       | userId, displayName, steamId64, truckersmpId, unitPreference (km/mi), showOnLiveMap                                                                                                                                                        | One profile per person                                         |
| `Company`                      | name, slug, tag, logo, truckersmpVtcId, verifiedAt, discordGuildId, settings                                                                                                                                                               | One per VTC                                                    |
| `Membership`                   | companyId, driverId, role (owner/manager/driver), status, joinedAt, leftAt, lastVtcCheckAt                                                                                                                                                 | History kept when someone leaves                               |
| `Application`                  | companyId, driverId, answers, status                                                                                                                                                                                                       | Recruitment                                                    |
| `Rank`                         | companyId, name, minKm, color, discordRoleId                                                                                                                                                                                               | Per-company rank ladder                                        |
| `Job`                          | driverId, companyId (null if solo), game, multiplayer, sourceCity, destCity, cargo, cargoMassKg, plannedKm, drivenKm, odometerStart, odometerEnd, income, damagePct, maxSpeed, startedAt, finishedAt, status (delivered/cancelled/flagged) | Counts for the company the driver was in when the job finished |
| `JobEvent`                     | jobId, type, at, payload                                                                                                                                                                                                                   | Speeding, fines, ferries, tolls                                |
| `Goal`                         | companyId, title, metric (km/jobs/income), target, startAt, endAt                                                                                                                                                                          | Progress computed from `Job`                                   |
| `TrackerDevice`                | driverId, tokenHash, appVersion, lastSeenAt                                                                                                                                                                                                | Revocable app tokens                                           |

Every company-owned table has `companyId`; one shared tRPC middleware checks the caller's role. Leaderboards and totals are queries over `Job`.

## Features (MVP)

Login with Discord + Steam link; automatic ETS2/ATS job logging; km/mi toggle; driver profile; leaderboards per company and global; company admin (members, roles, applications, flagged jobs); VTC sign-up with TruckersMP verification and public company pages; TruckersMP membership auto-check (on join + nightly); ranks by distance synced to Discord roles; Discord bot (delivery feed, rank-ups, monthly winners, event reminders); convoys of VTCs on Tacho, shown from TruckersMP (dashboard: your company's own convoys next to the other Tacho VTCs'; all Tacho VTCs on `/events`; Markdown descriptions; sign-ups stay on TruckersMP); live map (positions every 5 s over WebSocket, Leaflet, privacy toggles); company goals.

Later: anti-cheat review queue, mobile app (Expo, same REST API).

## What we need from our end

- Company: name, tag, logo, brand, domain (+ `api.`), VTC registered on TruckersMP, rules/about text.
- Accounts: GitHub repo, Discord server + Discord app (OAuth client ID/secret, bot token; bot verification needed at 100 servers), Steam Web API key, TruckersMP API (no key; cache, ask about rate limits), Windows code-signing certificate (can wait).
- Decisions: which jobs count (TruckersMP only or singleplayer too), rank names and thresholds, cancelled-job km, free vs paid extras, terms of service and privacy policy (GDPR).
- Decided 2026-11-12: the platform and tracker are called **Tacho** (after the tachograph). Tauri identifier `app.tacho.tracker`.
- People: owner for web/backend, owner for tracker, 2–3 beta drivers (ETS2 and ATS), moderators for verification and abuse reports.

## Hosting

One Linux VM with Docker to start: 4 vCPU, 8 GB RAM, 40 GB SSD; Postgres 16+ (container or managed); Caddy or Traefik with Let's Encrypt (must pass WebSockets); DNS for the domain and `api.`; nightly `pg_dump` kept 14 days off-server; installer hosting (GitHub Releases); deploy key for GitHub Actions. Provider details to come.

## Roadmap

1. **Foundation:** monorepo, Discord + Steam login, Prisma schema, deploy to our host. Gate: first job saved end to end.
2. **Tracker beta:** tracker + plugin, jobs and position API, live map, our VTC as beta. Gate: one clean beta week.
3. **MVP launch:** TruckersMP check + ranks, Discord bot, events + goals, open VTC sign-up. Gate: our VTC fully tracked.
4. **After launch:** review queue, signed installer, public VTC directory, mobile app (maybe).

## Open questions

- Hosting provider and what it offers.
- macOS/Linux tracker support or Windows only at first.
- Code-signing before launch or accept SmartScreen warnings in beta.
- English only or English + Norwegian.
- Companies not registered on TruckersMP (singleplayer-only VTCs)?
- Private beta with our VTC before opening sign-ups?
- Import old Trucky/TrucksBook history?

## Decisions log

- 2026-11-12: Convoys and events are run on TruckersMP; Tacho only displays them, and only for VTCs that use Tacho. The driver dashboard has two columns: convoys the driver's own company created, and convoys created by the other VTCs on Tacho. `/events` lists convoys from every verified Tacho VTC. Convoys a VTC only attends, and general public TruckersMP events, are not shown. Descriptions and rules are Markdown. The `Event` and `EventSignup` tables were dropped.
