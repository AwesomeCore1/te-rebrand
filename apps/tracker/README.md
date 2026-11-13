# Tacho tracker

Tauri 2 desktop app: React UI in `src/`, Rust in `src-tauri/`. The tracking logic itself is in `crates/telemetry`.

## Run it

```bash
bun run dev:web       # the API the tracker talks to (http://localhost:3001)
bun run dev:tracker   # Vite on :1420 + the Tauri window
```

The API URL comes from `TACHO_API_URL` (at runtime, else at build time), defaulting to `http://localhost:3001`.

On macOS there is no game telemetry. Use **Link account**, approve the code on the website, then **Replay a delivery**: the recorded Hamburg to Lyon drive goes through the real pipeline and appears on your dashboard.

## In the tray

Tacho lives in the system tray (`src-tauri/src/tray.rs`, `shell.rs`). Left click on the icon opens the window; the menu has Open Tacho, one line that follows the tracker ("Waiting for the game", "Tracking: Hamburg to Lyon", "2 jobs waiting to send") and Quit Tacho.

- Closing the window hides it and tracking continues. The first time, the window stays and says so; that is remembered in `prefs.json`. Only Quit ends the app.
- While the window is hidden it gets no status updates; it is brought up to date when it is shown.
- Starting Tacho a second time shows the running one (`tauri-plugin-single-instance`).
- **Start with Windows** (Settings, off by default) writes `"<exe>" --autostart` to the current user's `Run` key (`autostart.rs`). Started with `--autostart`, the window stays hidden. A development build registers itself as "Tacho (dev)", pointing at `target/debug/tracker.exe`.
- On Windows 11 a tray icon starts out behind the small arrow next to the clock; the driver can drag it onto the taskbar.

## The game (Windows)

The tracker reads the memory map of the RenCloud scs-sdk-plugin, revision 12 (release [V.1.12.1](https://github.com/RenCloud/scs-sdk-plugin/releases/tag/V.1.12.1)). Other revisions are refused, and the window says so.

### Finding the games and installing the plugin

`src-tauri/src/games.rs` finds ETS2 (Steam app 227300) and ATS (270880): Steam's folder from the registry, its libraries from `steamapps/libraryfolders.vdf`, the game's folder from `appmanifest_<id>.acf`. A game counts as installed once `bin/win_x64` exists. Games installed outside Steam are not found.

`src-tauri/src/plugin.rs` reports the state of `bin/win_x64/plugins/scs-telemetry.dll` (missing, ours, a different file, unreadable) and installs it. **Nothing is written without a click:** the Live job view shows a setup card with one button while a game has no plugin, and Settings has a Games section with install, replace and reinstall. A different `scs-telemetry.dll` is only replaced after the driver confirms. If the game is running (file in use) or Windows refuses the write, the message names the folder.

After installing, the game shows an "SDK features" notice on its next start; the driver accepts it once.

The DLL is shipped as a Tauri resource, with its licence:

- `src-tauri/resources/scs-telemetry/scs-telemetry.dll`: the unmodified `Win64/scs-telemetry.dll` from `release_v_1_12_1.zip`, SHA-256 `1d03dbc7a975e72203c60a7b9998021ceb8800b836bf28a131279979ad386cd4`.
- `src-tauri/resources/scs-telemetry/LICENSE.txt`: the plugin's MIT licence.

The hash is pinned in `plugin.rs`. A test checks the file in the repository against it, and every install checks the copy on disk again before writing. To move to another plugin release, change the DLL, the hash and `PLUGIN_REVISION` in `crates/telemetry/src/scs.rs` together.

To check what is found on your own PC without writing anything:

```bash
cargo test -p tracker locate_on_this_pc -- --ignored --nocapture
```

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
- `prefs.json`: small things the app remembers (that the driver has been told about the tray).

## End-to-end test

`cargo test -p tracker e2e -- --ignored` links a tracker, replays a delivery and checks the API saved it. It needs a running web server (`TACHO_E2E_URL`) and the link code approved by a driver: the test writes the code to `TACHO_E2E_CODE_FILE` and waits up to 90 s.
