# How It Works

A step-by-step walkthrough of how Actium Tunnel operates, from app launch to proxied request.

## 1. App Launch

1. `main.rs` initializes tracing, creates `AppState` (registry, config, bandwidth tracker, connection log)
2. Tauri builder sets up:
   - System tray icon with Open/Quit menu
   - Window close handler (hide to tray instead of quit)
   - Crash reporter panic hook
   - Background update checker (5s delay, then every 4 hours)
3. `restore_from_config()` loads saved accounts from `config.toml`, retrieves their API keys from the OS keychain, and reconnects each tunnel

## 2. Adding an Account

1. User pastes an Actium API key in the Add Account modal
2. Frontend calls `add_account` Tauri command
3. Rust side:
   - Validates the key against the Actium portal API (`auth.rs`)
   - Portal returns workspace ID and name
   - Generates a UUID for the account
   - Stores the API key in the OS keychain
   - Saves account config to `config.toml`
   - Creates a `Tunnel` and starts connection with backoff

## 3. Tunnel Connection

1. `Tunnel::connect()` builds a WebSocket upgrade request to `wss://relay.actium.io/tunnel`
2. Request includes headers: `X-Actium-Api-Key`, `X-Actium-Workspace-Id`, `X-Tunnel-Version`
3. On successful handshake, state transitions to `Connected`
4. A tokio task runs the message loop, handling:
   - **Binary frames** — proxy requests from the relay
   - **Ping/Pong** — keep-alive
   - **Close** — graceful disconnect
   - **Errors** — transition to `Error` state, trigger backoff reconnect

## 4. Proxy Request Flow

When an Actium cloud agent needs to access a website:

```
Agent → Relay → [Binary Frame] → Tunnel App
```

### Frame Parsing

The binary frame format:
```
[4 bytes: session ID][2 bytes: port, big-endian][host string\0][HTTP payload]
```

### Security Checks

1. **Allowlist check** — is the target host in the hardcoded domain list? If not, return `0x01` (blocked) and log the attempt
2. **Bandwidth cap check** — has this account exceeded its daily limit? If so, return `0x02` (cap reached)

### Request Forwarding

3. Open a TCP connection to `host:port`
4. Write the HTTP payload to the target
5. Read the response (up to 64KB per frame)
6. Record bandwidth usage
7. Log the connection in the connection log

### Response

```
[4 bytes: session ID][1 byte: 0x00 success][response bytes]
```

The relay forwards this back to the cloud agent, completing the round trip.

## 5. Reconnection

If the WebSocket disconnects:

1. The message loop exits, setting state to `Disconnected` (or `Error` if it was a failure)
2. `spawn_tunnel_with_backoff` detects the state change
3. Reconnection attempts follow exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s → 60s
4. If disconnection was due to auth failure (401/403), reconnection is NOT attempted
5. On successful reconnect, backoff resets to 0

## 6. Updates

### Checking

- Background task checks every 4 hours
- Frontend can trigger a manual check from the About screen
- Relay version rejection triggers an immediate check

### Urgency

Release notes can embed urgency as a JSON prefix:
```
{"urgency":"security"}
Critical fix for SOCKS5 validation bypass.
```

| Urgency | UI Behavior |
|---------|-------------|
| `security` | Full-screen blocking overlay, cannot dismiss |
| `required` | Full-screen blocking overlay, cannot dismiss |
| `recommended` | Dismissible banner at top of app |
| `optional` | No proactive prompt, visible in About screen |

### Install Flow

1. User clicks "Update to vX.Y.Z"
2. Tauri downloads the update and verifies its Ed25519 signature
3. Update is staged for next launch
4. User clicks "Restart to apply"

## 7. Crash Recovery

If the Rust backend panics:

1. Custom panic hook (`crash_reporter.rs`) captures the panic message, location, and backtrace
2. Writes `last_crash.json` to the config directory
3. On next launch, `get_previous_crash` reads and deletes the file
4. Frontend shows a crash recovery screen with option to report

## 8. Bug Reports

1. User clicks "Report a problem" (About screen, error cards, or crash recovery)
2. Frontend calls `build_bug_report` with description and optional email
3. Rust side assembles a payload with:
   - App version and OS info
   - Tunnel states (no keys or IDs)
   - Recent connection log entries (last 50)
   - All text run through `log_sanitiser` to redact API keys, workspace IDs, IPs, and tokens
4. User previews the sanitised payload
5. User confirms to send to the portal's bug report endpoint

## 9. Bandwidth Tracking

- Each proxied request records bytes sent + received against the account
- `BandwidthTracker` uses a `HashMap<String, u64>` with auto-reset at midnight (day-of-year change)
- When usage exceeds the cap, new proxy requests are rejected with status `0x02`
- Default cap: 500 MB/day, configurable per account

## 10. Domain Allowlist

The allowlist in `allowlist.rs` is a static array of domain strings compiled into the binary. The `is_allowed()` function checks:
- Exact match (case-insensitive)
- Subdomain match (e.g., `sub.example.com` matches if `example.com` is in the list)

This runs on every proxy request, both in the WebSocket tunnel handler and the SOCKS5 proxy.
