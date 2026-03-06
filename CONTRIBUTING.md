# Contributing

## Development Setup

### Prerequisites

- [Rust](https://rustup.rs/) — stable toolchain (pinned via `rust-toolchain.toml`)
- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 8
- Tauri system dependencies — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Getting Started

```bash
git clone https://github.com/actium/tunnel.git
cd tunnel
pnpm install
```

### Running in Development

```bash
# Desktop app (frontend hot-reload + Rust backend)
pnpm dev

# Relay server
pnpm --filter relay dev
```

### Running Tests

```bash
# Rust tests
cd packages/desktop/src-tauri
cargo test

# TypeScript type check
cd packages/desktop
npx tsc --noEmit

# Frontend build check
cd packages/desktop
npx vite build
```

## Project Layout

| Path | Description |
|------|-------------|
| `packages/desktop/src-tauri/src/` | Rust backend — tunnels, proxy, auth, config |
| `packages/desktop/src/` | React frontend — UI components and hooks |
| `apps/relay/src/` | Node.js WebSocket relay server |
| `workers/tunnel-update-server/` | Cloudflare Worker for update manifests |
| `scripts/` | CI helper scripts |
| `.github/workflows/` | GitHub Actions release pipeline |

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed design docs.

## Code Conventions

### Rust

- Format with `cargo fmt`
- Lint with `cargo clippy`
- No warnings in CI — all code must compile warning-free
- Tests go in `#[cfg(test)] mod tests` blocks in the same file
- Use `tracing` for logging, not `println!`

### TypeScript / React

- Typed Tauri command wrappers live in `src/lib/tauri.ts`
- Components are function components, no class components (except `ErrorBoundary`)
- No global state library — use component-local state + Tauri invoke
- CSS is plain CSS in `src/styles.css`, no CSS-in-JS

### Security

- Never log API keys, tokens, or secrets
- Never store API keys outside the OS keychain
- All user-facing error data must go through `log_sanitiser` before display or transmission
- The domain allowlist is source-code only — no runtime modification

## Making Changes

### Adding a New Tauri Command

1. Add the command function in the appropriate Rust module (e.g., `main.rs`)
2. Register it in the `invoke_handler` macro in `main.rs`
3. Add a typed wrapper in `packages/desktop/src/lib/tauri.ts`
4. Call it from the frontend via the wrapper

### Adding a Domain to the Allowlist

Edit the `ALLOWED_DOMAINS` array in `packages/desktop/src-tauri/src/allowlist.rs`. This requires a new release — the allowlist is compiled into the binary.

### Adding a New Frontend View

1. Create the component in `packages/desktop/src/components/`
2. Add the view name to the `View` type in `App.tsx`
3. Add a nav item in the sidebar
4. Add the view render in the main content area

## Release Process

Releases are automated via GitHub Actions:

1. Create a git tag: `git tag v0.2.0 && git push --tags`
2. The release workflow builds for macOS (aarch64 + x86_64), Windows, and Linux
3. `tauri-action` creates the GitHub release with signed artifacts
4. `publish-release-manifest.js` uploads `latest.json` to Cloudflare R2
5. Running clients pick up the update via the background checker

### Update Urgency

To set update urgency, prefix the GitHub release body with JSON:

```
{"urgency":"security"}
Security fix: tightened SOCKS5 validation.
```

Options: `security`, `required`, `recommended` (default), `optional`.

## Questions?

Open an issue on GitHub or email the team.
