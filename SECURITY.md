# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.x.x   | Current release only |

Only the latest release receives security updates. The relay server enforces a minimum client version — older clients are rejected at the WebSocket level and prompted to update.

## Reporting a Vulnerability

If you discover a security vulnerability in Actium Tunnel, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email: **security@actium.io**

Include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Your suggested fix (if any)

We will acknowledge receipt within 24 hours and aim to release a fix within 72 hours for critical issues.

## Security Architecture

Actium Tunnel is designed with a minimal trust surface:

- **Hardcoded domain allowlist** — compiled into the binary. The relay server cannot modify it.
- **API keys stored in OS keychain** — never in config files, never in logs.
- **Log sanitisation** — all bug reports redact API keys, workspace IDs, IPs, and tokens before transmission.
- **Signed updates** — Tauri's built-in updater verifies Ed25519 signatures. The public key is committed to the repo; the private key is held in CI secrets only.
- **Localhost-only proxy** — the SOCKS5 proxy binds to 127.0.0.1, never 0.0.0.0.
- **No telemetry** — no background data collection. Bug reports are user-initiated and user-reviewable before sending.

## Update Signing

The update signing keypair is generated once with `pnpm tauri signer generate`. The private key is stored in GitHub Actions secrets (`TAURI_PRIVATE_KEY`). The public key is in `tauri.conf.json`. If the private key is compromised, rotate it and issue a new release — all existing installs will need to reinstall manually.
