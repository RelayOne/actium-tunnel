# Architecture

## System Overview

Actium Tunnel is a three-component system: a desktop app, a relay server, and an update server.

```
                                   Internet
                                      ^
                                      |
[Actium Cloud Agent] -----> [Relay Server] <---WebSocket---> [Desktop App] ---> [Target Sites]
         |                    (apps/relay)                   (packages/desktop)
         |                        |
         v                        v
   [Actium Portal]          [Portal API]
   (auth + config)        (key validation,
                           bandwidth reports)
```

### Desktop App (`packages/desktop/`)

A Tauri v2 app with a Rust backend and React frontend. The Rust side manages:

- **Tunnel connections** — one WebSocket per account to the relay
- **Request handling** — receives binary frames from the relay, makes HTTP requests to target sites, returns responses
- **Domain enforcement** — hardcoded allowlist checked on every request
- **Bandwidth tracking** — per-account daily byte counters with configurable caps
- **API key storage** — OS keychain via the `keyring` crate

The React frontend provides:

- Account management (add/remove API keys)
- Connection status with live polling
- Bandwidth usage visualisation
- Connection log viewer
- Domain allowlist viewer
- Update prompts with urgency levels
- Bug report builder with data preview

### Relay Server (`apps/relay/`)

A Node.js WebSocket server that bridges cloud agents and desktop tunnels:

- Authenticates tunnels via API key headers
- Routes incoming proxy requests to the correct tunnel by workspace ID
- Uses a binary protocol for efficiency: `[session-id][port][host\0][payload]`
- Enforces minimum client version — rejects outdated tunnels with a version rejection event
- Reports bandwidth usage to the portal API periodically

### Update Server (`workers/tunnel-update-server/`)

A Cloudflare Worker that serves update manifests from R2 storage. The Tauri updater plugin queries this endpoint to check for new versions.

## Key Design Decisions

### Hardcoded Allowlist

The domain allowlist is compiled into the binary (`allowlist.rs`). It cannot be modified at runtime, by the relay, or by config files. This is intentional — the tunnel should only proxy traffic to known, approved domains.

### API Keys in OS Keychain

API keys are never stored in config files or logged. The `keyring` crate stores them in:
- macOS Keychain
- Windows Credential Manager
- Linux Secret Service (GNOME Keyring / KWallet)

### Binary Protocol

The relay-to-tunnel protocol uses raw binary frames rather than JSON for performance:

```
[4 bytes: session ID][2 bytes: port (big-endian)][host string\0][payload bytes]
```

Response format:
```
[4 bytes: session ID][1 byte: status code][response payload]
```

Status codes: `0x00` = success, `0x01` = blocked by allowlist, `0x02` = bandwidth cap, `0x03` = connection failed.

### Exponential Backoff Reconnection

When a tunnel disconnects, the registry automatically reconnects with exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s, 60s (max). Auth failures are not retried.

### Update Urgency System

Release notes can embed urgency metadata as a JSON prefix:

```
{"urgency":"security"}
Security fix: tightened SOCKS5 validation.
```

Urgency levels:
- `security` — blocking overlay, cannot dismiss
- `required` — blocking overlay, cannot dismiss
- `recommended` — dismissible banner
- `optional` — no proactive prompt

## Data Flow

See [HOW-IT-WORKS.md](HOW-IT-WORKS.md) for a step-by-step walkthrough of how a proxy request flows through the system.

## Module Dependency Graph

```
main.rs
  ├── tunnel_registry.rs
  │     ├── tunnel.rs
  │     │     ├── allowlist.rs
  │     │     ├── bandwidth.rs
  │     │     └── connection_log.rs
  │     ├── auth.rs
  │     └── config.rs (keychain access)
  ├── proxy.rs (SOCKS5, localhost only)
  │     ├── allowlist.rs
  │     └── bandwidth.rs
  ├── updater.rs (tauri-plugin-updater)
  ├── crash_reporter.rs
  └── log_sanitiser.rs
```

## State Management

### Rust Side

- `AppState` — managed by Tauri, holds `TunnelRegistry`, `AppConfig`, `ConnectionLog`, `BandwidthTracker`
- `TunnelRegistry` — `Arc<RwLock<HashMap<String, Tunnel>>>`, owns all active tunnels
- `BandwidthTracker` — `Arc<RwLock<...>>`, shared across all tunnels, auto-resets daily
- `ConnectionLog` — `Arc<RwLock<VecDeque<...>>>`, capped at 1000 entries

### Frontend Side

- `useTunnelStatus` hook — polls `get_status` every 5 seconds, also listens for `tunnel:status_update` events
- Update state managed locally in `UpdatePrompt` via Tauri event listeners
- No global state library — component-local state with Tauri invoke calls

## CI/CD

The release pipeline (`.github/workflows/release.yml`) builds on:
- macOS (aarch64 + x86_64)
- Windows (x86_64)
- Linux (x86_64)

After all builds complete, `scripts/publish-release-manifest.js` collects the update signatures from the GitHub release assets and uploads a `latest.json` manifest to Cloudflare R2.
