# Tacho Discord bot

One bot for every VTC on Tacho. A VTC invites it to its own Discord server and picks channels on the website; the bot then posts there:

- **Deliveries**: each delivered job, in the delivery channel.
- **Rank-ups**: a post in the rank-up channel, the new rank's role given and the previous one taken away.
- **Rank roles kept right**: when a driver joins, leaves, is removed or is set inactive, and when a rank is added, edited or deleted, the members it concerns get the role of the rank they hold and lose the company's other rank roles. Nothing is posted for this.
- **Monthly winners**: on the 1st (UTC), the top three drivers of the month before by delivered distance.
- **Convoy reminders**: a day before and an hour before each convoy the VTC hosts on TruckersMP.

It is a small discord.js app run with Bun. It reads the same database as the website and has no HTTP port.

## Switching it on (platform owner, once)

1. Open https://discord.com/developers/applications. Use the application that already handles Discord login for the website (the one whose client id is `DISCORD_CLIENT_ID` in `apps/web/.env`), or create a new one. One application can do both.
2. **Bot** tab:
   - **Reset Token**, copy it. It is shown once.
   - **Public Bot**: on, so any VTC can invite it.
   - **Privileged Gateway Intents**: leave all three off (Presence, Server Members, Message Content). The bot needs none of them.
3. Create `apps/bot/.env` (git-ignored) with one line:

   ```
   DISCORD_BOT_TOKEN=the-token-you-copied
   ```

   The database URL is not repeated here: it is read from `apps/web/.env`.

4. Start it: `bun run dev:bot`. It should say `connected to Discord as <name>, in N server(s)`.

Discord asks for bot verification once the bot is in 100 servers (docs/PLAN.md).

### What the bot asks of Discord

| What                                       | Why                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Gateway intent **Guilds** (not privileged) | Knows which servers it is in, their channels and roles. Needed to check permissions and role order. |
| Permission **View Channels**               | See the channels it posts in.                                                                       |
| Permission **Send Messages**               | Post. (**Send Messages in Threads** too, only if a VTC picks a thread as a channel.)                |
| Permission **Embed Links**                 | Its posts are embeds.                                                                               |
| Permission **Manage Roles**                | Give and take rank roles. Only needed by VTCs that link roles to ranks.                             |

It does not read messages, has no commands, and never pings `@everyone`, `@here` or a role. The only ping it sends is to a driver on their own rank-up.

Invite link (replace the client id). `268454912` is exactly the four permissions above:

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot&permissions=268454912
```

## Setting it up for a VTC (owner or manager of that VTC)

1. Invite the bot with the link above. You need the **Manage Server** permission in the server to do that.
2. If ranks should give roles: in **Server Settings > Roles**, drag the bot's role **above** the rank roles. A bot can only give roles that sit below its own. Rank roles must be plain roles: the bot refuses to hand out a role that has admin or moderation permissions.
3. In Discord, turn on **User Settings > Advanced > Developer Mode**. Then right-click the server and choose **Copy Server ID**, and right-click each channel and choose **Copy Channel ID**.
4. On the Tacho website, in the company's settings, enter the server id and the channels (deliveries, rank-ups, events, monthly winners). Leave a channel empty to switch that kind of post off. For roles, enter each rank's role id (right-click the role > **Copy Role ID**).

Stored as `Company.discordGuildId`, `Company.settings.discord.*` and `Rank.discordRoleId`.

### The bot does not take a server id on trust

A manager could type in the id of another VTC's server that the bot happens to be in. So before it posts or changes roles for a company, the bot checks that:

- at least one **active owner or manager of that company**, by the Discord account they log in to Tacho with, has **Manage Server** in that server; and
- every channel it is about to post in **belongs to that server**.

If not, it does nothing there and writes the reason to the `bot_status` table (`guildOk`, `guildReason`). The answer is remembered for five minutes (one minute for a "no"), so a fixed setup starts working within a minute or so. Posts that were due while the check failed are not made up later.

Roles get the same care: the bot only gives a role that is the `discordRoleId` of a rank of **that** company at that moment, and never one with admin or moderation permissions. It takes a role only if it is such a rank role, or if the website recorded, in the same step as a rank edit or delete, that the role just stopped being one (so members do not keep the role of a rank that no longer has it). Any other role a member holds is never touched.

### How rank roles are kept right

The website writes a `rank_roles_sync` row per member whose roles may be wrong (`packages/api/src/rank-roles.ts`). The row names the member, not the role: when the bot gets to it, it reads from the database whether they are an active member and which rank they hold, looks up the roles they have in the server, and changes only what differs. So a member who is already right costs one lookup, a row that waited still ends in the right role, and running a row twice changes nothing.

A change to the ladder in a big company can write hundreds of rows. They are handled in a loop of their own, ten per round, so deliveries and rank-ups are never held up behind them.

## Running

```bash
bun run dev:bot                 # from the repo root
bun run --cwd apps/bot dev:watch  # restarts on file changes (each restart logs in to Discord again)
bun run --cwd apps/bot start    # what the Docker image runs
docker compose up -d bot        # in Docker, with the database from compose
```

Run **one** copy. Two copies will not double-post (every claim is a single database statement that only one can win), but there is nothing to gain.

Environment, checked by varlock (`.env.schema`):

| Variable            | Where it comes from                                             |
| ------------------- | --------------------------------------------------------------- |
| `DISCORD_BOT_TOKEN` | `apps/bot/.env`. Optional: see below.                           |
| `DATABASE_URL`      | `apps/web/.env` locally; set by `docker-compose.yml` in Docker. |

**Without a token** the bot starts, prints `DISCORD_BOT_TOKEN is not set ... The bot is idle` and stays up doing nothing. It does not exit, so `bun run dev` and `docker compose up` keep working on a machine that has no token. A token Discord rejects is reported the same way. Without `DATABASE_URL`, varlock stops the start with its own message.

## When something goes wrong

Nothing here needs a person to step in; this is what to expect and where to look.

| Situation                                                    | What the bot does                                                                                       | Where the reason is                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Company has no server or no channel for that kind of post    | Marks the event processed, posts nothing                                                                | `outbox_event.lastError` ("Skipped: ...")          |
| Server check fails, channel is in another server             | Same, and nothing is changed in that server                                                             | `bot_status.guildReason`, `bot_status.lastProblem` |
| Bot lacks a permission in the channel                        | Marks the event processed, posts nothing                                                                | `outbox_event.lastError`, `bot_status.lastProblem` |
| Bot lacks Manage Roles, or its role is below the rank role   | Posts the rank-up, leaves roles alone. A role sync is marked processed with the reason                  | same                                               |
| A member is not in the server, or has no Discord account     | Role sync skipped and marked processed; not tried again                                                 | `outbox_event.lastError` ("Skipped: ...")          |
| Discord is down or rate-limiting                             | Tries again after 15 s, 1 min, 5 min, 15 min, 1 h; gives up after 6 tries. Other events are not held up | `outbox_event.attempts`, `lastError`               |
| The bot stops between posting and writing that down          | One more try two minutes later, and no more after that: a post can appear twice, never three times      | `outbox_event.lastError`                           |
| A delivery is more than 24 hours old when the bot gets to it | Skipped, so a long outage does not end in a flood                                                       | `outbox_event.lastError`                           |

Monthly winners and convoy reminders are stricter: the bot writes a `bot_post` row **before** sending, so they can go missing after a crash at the wrong moment but can never appear twice. Monthly winners are made up for until the end of the 3rd if the bot was down on the 1st.

The rules are written out at the top of `src/outbox.ts` and `src/ledger.ts`.

## Code

```
src/discord.ts       the seven things the bot asks of Discord (an interface)
src/discord-js.ts    that interface on discord.js: the only file that needs a token to run
src/store.ts         what the bot asks of the database (an interface)
src/prisma-store.ts  that interface on Postgres
src/access.ts        the server and channel check
src/roles.ts         which roles may be given or taken, for a rank-up and for a sync
src/outbox.ts        deliveries, rank-ups and rank role syncs
src/ledger.ts        post-at-most-once for scheduled posts
src/monthly.ts       monthly winners
src/convoys.ts       convoy reminders
src/messages.ts      the wording
src/bot.ts, main.ts  wiring, timers, start-up
```

## Tests

```bash
bun run --cwd apps/bot test       # everything on a fake Discord and an in-memory database
bun run --cwd apps/bot test:db    # the database layer on the real Postgres from apps/web/.env
```

`test:db` creates rows whose ids start with `bottest-` and removes them again. It does not touch other rows.

Not covered by any test: `src/discord-js.ts` talking to the real Discord (it needs a token and a server). After setting a token, check once by hand: a delivery appears, a rank-up gives the role, an accepted application gives the starting rank's role, leaving the company takes it away, and a company pointed at a server it does not run gets nothing.
