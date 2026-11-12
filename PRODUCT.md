# Product

## Platform

web (website) and desktop (Tauri tracker, Windows first)

## Users

- **Drivers**: people who play ETS2 or ATS, often on TruckersMP, usually in the evening, often with the tracker on a second monitor or minimised in the tray. They want their kilometres to count without doing anything.
- **VTC managers and owners**: run a virtual trucking company of 5 to a few hundred drivers. They recruit, run convoys, and want leaderboards, ranks and Discord roles to run themselves.
- **Visitors**: drivers looking for a VTC, and VTC owners deciding whether to move their company here from Trucky or TrucksBook.

## Product Purpose

Log every delivery automatically and give each VTC a hub: leaderboards, ranks that become Discord roles, convoys, a live map and company goals. Success: a driver installs the tracker once and never thinks about it again; a VTC can stop using spreadsheets and manual job reports.

## Operating Context

- Tracker: runs while the game runs. It must be light on CPU and RAM and never interrupt the game. Most of the time nobody looks at it.
- Website: checked between drives and on phones (leaderboards, events, the live map during convoys).
- Our own VTC is the first company on the platform and the private beta.

## Capabilities and Constraints

- Telemetry comes from SCS's official SDK through the RenCloud scs-sdk-plugin; it works the same in ETS2 and ATS, in singleplayer and on TruckersMP.
- TruckersMP membership is checked through the TruckersMP API using the driver's SteamID64; there is one VTC per player on TruckersMP.
- Distances are stored in km; ATS players often want miles.
- Not affiliated with SCS Software or TruckersMP; never use their logos as our own.
- No invented numbers on public pages: no fake user counts, reviews or testimonials.

## Brand Commitments

Calm, precise, trucker-literate. Speaks like a dispatcher: short, factual, plain. Avoid gamer-neon, purple gradients, glassmorphism, "revolutionize your VTC" copy, emoji as content.

## Product Principles

1. **Invisible tracking.** The best tracker is one you forget is running.
2. **The numbers are the product.** Kilometres, jobs and ranks must be right and easy to scan; colour goes to data and state, not decoration.
3. **Every VTC is separate.** One company never sees another's admin data.
4. **Show the real thing.** Marketing shows the actual app and real UI, never mood images or feature-card filler.
