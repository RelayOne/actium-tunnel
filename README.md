# Actium Tunnel

A Tauri v2 desktop app that routes Actium agent traffic through your own residential IP address. Each workspace gets its own isolated WebSocket tunnel, authenticated by an Actium API key.

```
[Actium Agent] --> [Actium Relay] <--WebSocket--> [Tunnel App] --> [Internet via your IP]
```

The agent in the cloud has no direct internet access for social/search routes. It sends proxy requests through the relay, which forwards them to your tunnel. Traffic exits from your machine, from your real ISP IP.

## Features

- **Multi-account** — run multiple tunnels simultaneously, one per API key
- **Hardcoded domain allowlist** — only approved domains are proxied, compiled into the binary
- **Daily bandwidth caps** — per-account usage limits with real-time tracking
- **OS keychain storage** — API keys stored securely, never in config files
- **Auto-updates** — signed updates via Tauri updater with urgency levels
- **System tray** — runs in background, click to show/hide
- **Crash recovery** — panic hook captures crash reports for diagnosis
- **Log sanitisation** — all bug reports redact sensitive data before sending

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) (stable toolchain)
- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 8
- System dependencies for Tauri: see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development

```bash
# Install dependencies
pnpm install

# Run desktop app in dev mode (hot-reload frontend + Rust backend)
pnpm dev

# Run the relay server locally
pnpm --filter relay dev
```

### Building

```bash
# Production build of the desktop app
pnpm --filter desktop tauri build

# Build relay server
pnpm --filter relay build
```

### Testing

```bash
# Rust tests (allowlist, updater, log sanitiser)
cd packages/desktop/src-tauri && cargo test

# TypeScript type checking
pnpm --filter desktop typecheck
```

## Project Structure

```
actium-tunnel/
  packages/
    desktop/                    # Tauri v2 desktop app
      src-tauri/src/            # Rust backend
        main.rs                 # App bootstrap, tray icon, Tauri commands
        tunnel.rs               # WebSocket tunnel to Actium relay
        tunnel_registry.rs      # Multi-account tunnel management + backoff
        proxy.rs                # SOCKS5 proxy server (localhost only)
        allowlist.rs            # Hardcoded domain allowlist
        bandwidth.rs            # Per-account daily byte tracking
        config.rs               # TOML config + OS keychain
        auth.rs                 # API key validation against portal
        connection_log.rs       # In-memory connection log (last 1000)
        updater.rs              # Update checker with urgency parsing
        crash_reporter.rs       # Panic hook + crash file
        log_sanitiser.rs        # Regex redaction for bug reports
      src/                      # React frontend
        App.tsx                 # Shell with sidebar nav
        components/             # AccountList, ConnectionLog, UpdatePrompt, etc.
        hooks/                  # useTunnelStatus polling hook
        lib/tauri.ts            # Typed invoke() wrappers
  apps/
    relay/                      # WebSocket relay server (Node.js)
      src/
        index.ts                # WS server with auth + keep-alive
        tunnel-registry.ts      # workspace -> tunnel routing
        session-router.ts       # Binary protocol frame routing
        auth-middleware.ts       # API key validation
        bandwidth-reporter.ts   # Usage reporting to portal
  workers/
    tunnel-update-server/       # Cloudflare Worker serving update manifests
  scripts/
    publish-release-manifest.js # CI script: collect signatures -> R2
  .github/workflows/
    release.yml                 # Cross-platform build + release pipeline
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed system design and [HOW-IT-WORKS.md](HOW-IT-WORKS.md) for the data flow walkthrough.

## Configuration

The app stores configuration at:
- **Config file**: `{OS config dir}/actium-tunnel/config.toml`
- **API keys**: OS keychain (via `keyring` crate)
- **Crash reports**: `{OS config dir}/actium-tunnel/last_crash.json` (auto-deleted on read)

### Self-hosting

To point at a different relay server, change the constant in `packages/desktop/src-tauri/src/tunnel.rs`:

```rust
pub const ACTIUM_RELAY_URL: &str = "wss://your-relay.example.com/tunnel";
```

Then rebuild. That's the intentional escape hatch.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting and security architecture details.

Key points:
- Domain allowlist is compiled into the binary — the relay cannot modify it
- API keys never touch disk — stored in OS keychain only
- Bug reports are sanitised (API keys, IPs, tokens redacted) and user-reviewable before sending
- Updates are signed with Ed25519 — public key in repo, private key in CI secrets
- SOCKS5 proxy binds to `127.0.0.1` only, never `0.0.0.0`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and contribution guidelines.

## License

Proprietary. See LICENSE for details.
