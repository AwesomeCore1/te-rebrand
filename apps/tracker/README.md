# Tacho tracker

Tauri 2 desktop app: React UI in `src/`, Rust in `src-tauri/`. The tracking logic itself is in `crates/telemetry`.

## Run it

```bash
bun run dev:web       # the API the tracker talks to (http://localhost:3001)
bun run dev:tracker   # Vite on :1420 + the Tauri window
```

The API URL comes from `TACHO_API_URL` (at runtime, else at build time), defaulting to `http://localhost:3001`.

On macOS there is no game telemetry. Use **Link account**, approve the code on the website, then **Replay a delivery**: the recorded Hamburg to Lyon drive goes through the real pipeline and appears on your dashboard.

## The game (Windows)

The tracker reads the memory map of the RenCloud scs-sdk-plugin, revision 12 (release [V.1.12.1](https://github.com/RenCloud/scs-sdk-plugin/releases/tag/V.1.12.1)). Other revisions are refused, and the window says so. Until the tracker installs the plugin itself, copy `Win64/scs-telemetry.dll` from that release into the game's `bin/win_x64/plugins` folder (create `plugins` if it is missing) and accept the SDK notice when the game starts.

To see what the tracker reads without the app or an account:

```bash
cargo run -p te-telemetry --example watch                       # job events, and a line every 5 s
cargo run -p te-telemetry --example watch -- --record drive.jsonl  # also save every frame, for a fixture
```

A job counts as TruckersMP when TruckersMP's DLL (`core_ets2mp.dll`, `core_atsmp.dll`) is loaded in the game. If the game runs as administrator and the tracker does not, that can't be seen and the job is sent as singleplayer.

## Files on disk

In the app data folder (macOS `~/Library/Application Support/app.tacho.tracker`, Windows `%APPDATA%\app.tacho.tracker`):

- `auth.json`: the device token (user-only permissions). Revoke it from the website dashboard.
- `queue.json`: finished jobs not sent yet. Sent oldest first; kept across restarts and offline time.
- `rejected.jsonl`: jobs the API refused (bad payload). Kept for support, never retried.

## End-to-end test

`cargo test -p tracker e2e -- --ignored` links a tracker, replays a delivery and checks the API saved it. It needs a running web server (`TACHO_E2E_URL`) and the link code approved by a driver: the test writes the code to `TACHO_E2E_CODE_FILE` and waits up to 90 s.
