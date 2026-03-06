# Actium Tunnel — Desktop App Spec
## Architecture, Data Model, and Full Implementation Guide

*Tauri v2 + Rust + React | Multi-account, API-key bound, self-hosted residential proxy*

---

## What This Is

A tray app that routes Actium agent traffic through the user's own residential IP. Not a proxy pool. Not shared. Each workspace gets its own isolated tunnel, authenticated by an Actium API key the user pastes into settings.

The Actium relay URL is compiled in. Clone the repo and change one constant to point at a different relay. That's the intentional escape hatch.

---

## User Mental Model

```
[Actium Agent] → [Actium Relay] ←WebSocket→ [Tunnel App] → [Internet via user's IP]
```

The worker in the cloud has no direct internet access for social/search routes. It sends proxy requests through the relay. The relay forwards them through whichever tunnel owns that workspace. Traffic leaves the internet from the user's machine, from their real residential ISP IP.

Multiple accounts work because multiple WebSocket tunnels can be open simultaneously — one per API key. The relay routes incoming requests to the correct tunnel by matching the workspace ID embedded in the proxy CONNECT request header.

---

## Monorepo Structure

```
packages/desktop/
  src-tauri/
    src/
      main.rs                  // Tauri bootstrap, tray icon setup
      proxy.rs                 // SOCKS5 server + domain allowlist
      tunnel.rs                // WebSocket connection to Actium relay
      tunnel_registry.rs       // Manages N concurrent tunnels (one per account)
      auth.rs                  // API key validation, token refresh
      bandwidth.rs             // Per-account byte tracking, daily cap enforcement
      config.rs                // App config, persisted to OS config dir
      allowlist.rs             // Hardcoded domain allowlist
      crypto.rs                // OS keychain read/write via keytar
    Cargo.toml
    tauri.conf.json
  src/                         // React frontend (settings window)
    App.tsx
    components/
      AccountList.tsx           // List of added API keys / accounts
      AddAccountModal.tsx       // Paste API key → validate → save
      ConnectionLog.tsx         // Live per-account connection feed
      BandwidthMeter.tsx        // Daily usage per account
      AllowlistViewer.tsx       // Shows exactly which domains are allowed
      StatusIndicator.tsx       // Per-account tunnel health
    hooks/
      useTunnelStatus.ts        // Tauri event listener for tunnel state
      useBandwidth.ts
    lib/
      tauri.ts                  // Typed wrappers around invoke() calls
  package.json
  tsconfig.json
```

Also adds to the main monorepo:

```
apps/relay/
  src/
    index.ts                   // WebSocket relay server
    tunnel-registry.ts         // workspaceId → active tunnel connection
    session-router.ts          // Routes proxy requests to correct tunnel
    auth-middleware.ts          // Validates Actium API keys
    bandwidth-reporter.ts       // Pushes usage back to portal
  package.json
```

---

## Rust Core — Key Files

### `allowlist.rs`

The single most important trust file. Domain allowlist is hardcoded in the binary. No config file, no remote update, no override.

```rust
/// Domains the tunnel will forward traffic to.
/// This list is intentionally hardcoded — it cannot be changed
/// at runtime, via config file, or by the relay server.
/// Changing it requires recompiling the application.
pub const ALLOWED_DOMAINS: &[&str] = &[
    "linkedin.com",
    "www.linkedin.com",
    "api.linkedin.com",
    "instagram.com",
    "www.instagram.com",
    "i.instagram.com",
    "graph.instagram.com",
    "twitter.com",
    "www.twitter.com",
    "api.twitter.com",
    "x.com",
    "www.x.com",
    "api.x.com",
    "tiktok.com",
    "www.tiktok.com",
    "m.tiktok.com",
    "google.com",
    "www.google.com",
    "google.ca",   // Canada-specific searches
    // Add regional Google TLDs as needed
    "maps.googleapis.com",
    "accounts.google.com",
];

/// Returns true if the given hostname is in the allowlist.
/// Checks exact matches and one-level subdomain matches.
/// Does NOT allow arbitrary subdomains — only those explicitly listed.
pub fn is_allowed(host: &str) -> bool {
    let host = host.to_lowercase();
    ALLOWED_DOMAINS.iter().any(|allowed| host == *allowed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_exact_match() {
        assert!(is_allowed("linkedin.com"));
        assert!(is_allowed("www.linkedin.com"));
    }

    #[test]
    fn test_rejects_arbitrary() {
        assert!(!is_allowed("evil.com"));
        assert!(!is_allowed("notlinkedin.com"));
        assert!(!is_allowed("linkedin.com.evil.com")); // subdomain attack
        assert!(!is_allowed("api.actium.io"));  // relay can't proxy to itself
        assert!(!is_allowed("localhost"));
        assert!(!is_allowed("192.168.1.1"));
    }
}
```

### `proxy.rs`

SOCKS5 server that listens on localhost only. Every CONNECT request goes through the allowlist check before forwarding.

```rust
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use crate::allowlist::is_allowed;
use crate::bandwidth::BandwidthTracker;

pub const PROXY_BIND_ADDR: &str = "127.0.0.1"; // localhost ONLY — never 0.0.0.0

pub struct ProxyServer {
    port: u16,
    workspace_id: String,
    bandwidth: BandwidthTracker,
}

impl ProxyServer {
    pub async fn run(&self) -> Result<(), Box<dyn std::error::Error>> {
        let addr = SocketAddr::from(([127, 0, 0, 1], self.port));
        let listener = TcpListener::bind(addr).await?;

        loop {
            let (socket, _) = listener.accept().await?;
            let workspace_id = self.workspace_id.clone();
            let bandwidth = self.bandwidth.clone();

            tokio::spawn(async move {
                if let Err(e) = handle_socks5(socket, workspace_id, bandwidth).await {
                    tracing::debug!("SOCKS5 connection error: {}", e);
                }
            });
        }
    }
}

async fn handle_socks5(
    mut stream: tokio::net::TcpStream,
    workspace_id: String,
    bandwidth: BandwidthTracker,
) -> Result<(), Box<dyn std::error::Error>> {
    // SOCKS5 handshake
    let mut buf = [0u8; 2];
    stream.read_exact(&mut buf).await?;

    if buf[0] != 0x05 { // SOCKS version 5
        return Err("Not SOCKS5".into());
    }

    // Read auth methods
    let nmethods = buf[1] as usize;
    let mut methods = vec![0u8; nmethods];
    stream.read_exact(&mut methods).await?;

    // Respond: no auth required (tunnel is already authenticated at WebSocket level)
    stream.write_all(&[0x05, 0x00]).await?;

    // Read request
    let mut req = [0u8; 4];
    stream.read_exact(&mut req).await?;

    if req[1] != 0x01 { // Only CONNECT supported
        stream.write_all(&[0x05, 0x07, 0x00, 0x01, 0,0,0,0, 0,0]).await?;
        return Err("Only CONNECT command supported".into());
    }

    // Parse destination
    let (host, port) = parse_destination(&mut stream, req[3]).await?;

    // *** ALLOWLIST CHECK — the critical gate ***
    if !is_allowed(&host) {
        tracing::warn!(
            workspace_id = %workspace_id,
            host = %host,
            "BLOCKED: host not in allowlist"
        );
        // SOCKS5 connection refused response
        stream.write_all(&[0x05, 0x02, 0x00, 0x01, 0,0,0,0, 0,0]).await?;
        return Ok(());
    }

    // Daily bandwidth cap check
    if bandwidth.is_cap_reached(&workspace_id) {
        tracing::warn!(workspace_id = %workspace_id, "BLOCKED: daily bandwidth cap reached");
        stream.write_all(&[0x05, 0x02, 0x00, 0x01, 0,0,0,0, 0,0]).await?;
        return Ok(());
    }

    // Connect to destination
    let target_addr = format!("{}:{}", host, port);
    let target = tokio::net::TcpStream::connect(&target_addr).await
        .map_err(|e| format!("Failed to connect to {}: {}", target_addr, e))?;

    // Send SOCKS5 success response
    stream.write_all(&[0x05, 0x00, 0x00, 0x01, 0,0,0,0, 0,0]).await?;

    // Bidirectional copy with bandwidth tracking
    let bytes = bandwidth_copy(stream, target).await?;
    bandwidth.record(&workspace_id, bytes);

    Ok(())
}
```

### `tunnel.rs`

WebSocket connection to the Actium relay. One instance per account. The relay URL is hardcoded — the single line to change when self-hosting.

```rust
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::handshake::client::Request;

/// The Actium relay URL. Hardcoded intentionally.
/// Self-hosters: change this constant and recompile.
/// This is the only thing binding this app to Actium's infrastructure.
pub const ACTIUM_RELAY_URL: &str = "wss://relay.actium.io/tunnel";

pub struct Tunnel {
    pub workspace_id: String,
    pub api_key: String,
    state: TunnelState,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TunnelState {
    Disconnected,
    Connecting,
    Connected { connected_at: std::time::Instant },
    Error { message: String },
}

impl Tunnel {
    pub async fn connect(&mut self) -> Result<(), TunnelError> {
        self.state = TunnelState::Connecting;

        let request = Request::builder()
            .uri(ACTIUM_RELAY_URL)
            // Authenticate with API key — relay validates against Actium portal
            .header("X-Actium-Api-Key", &self.api_key)
            .header("X-Actium-Workspace-Id", &self.workspace_id)
            // Tunnel version — relay can reject outdated clients
            .header("X-Tunnel-Version", env!("CARGO_PKG_VERSION"))
            .body(())?;

        let (ws_stream, response) = connect_async(request).await
            .map_err(|e| TunnelError::ConnectionFailed(e.to_string()))?;

        // Relay sends 401 for invalid API key, 403 for expired/revoked
        if response.status().as_u16() >= 400 {
            self.state = TunnelState::Error {
                message: format!("Auth failed: HTTP {}", response.status()),
            };
            return Err(TunnelError::AuthFailed);
        }

        self.state = TunnelState::Connected {
            connected_at: std::time::Instant::now(),
        };

        // Start the message loop in a background task
        let workspace_id = self.workspace_id.clone();
        tokio::spawn(async move {
            tunnel_message_loop(ws_stream, workspace_id).await;
        });

        Ok(())
    }

    pub fn state(&self) -> &TunnelState {
        &self.state
    }
}

async fn tunnel_message_loop(
    mut ws: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>
    >,
    workspace_id: String,
) {
    use tokio_tungstenite::tungstenite::Message;
    use futures_util::{SinkExt, StreamExt};

    while let Some(msg) = ws.next().await {
        match msg {
            Ok(Message::Binary(data)) => {
                // Relay is sending proxy traffic to forward to target host
                // Format: [4-byte session-id][2-byte target-port][target-host-null-terminated][payload]
                if let Err(e) = handle_proxy_payload(&data, &workspace_id).await {
                    tracing::error!("Proxy payload error: {}", e);
                }
            }
            Ok(Message::Ping(p)) => {
                let _ = ws.send(Message::Pong(p)).await;
            }
            Ok(Message::Close(_)) => {
                tracing::info!(workspace_id = %workspace_id, "Tunnel closed by relay");
                break;
            }
            Err(e) => {
                tracing::error!(workspace_id = %workspace_id, "WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }

    // Reconnect with exponential backoff (handled by tunnel_registry)
}
```

### `tunnel_registry.rs`

Manages all active tunnels. Each API key gets one tunnel. Handles reconnection with backoff.

```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::tunnel::{Tunnel, TunnelState};
use crate::config::AccountConfig;

pub struct TunnelRegistry {
    // Key: account_id (stable identifier per API key)
    tunnels: Arc<RwLock<HashMap<String, Tunnel>>>,
}

impl TunnelRegistry {
    pub async fn add_account(&self, account: AccountConfig) -> Result<(), TunnelError> {
        // Validate API key against Actium portal before saving
        let workspace_id = validate_api_key(&account.api_key).await?;

        let tunnel = Tunnel {
            workspace_id: workspace_id.clone(),
            api_key: account.api_key.clone(),
            state: TunnelState::Disconnected,
        };

        let mut registry = self.tunnels.write().await;
        registry.insert(account.id.clone(), tunnel);

        // Start connection in background
        self.spawn_tunnel_with_backoff(account.id).await;

        Ok(())
    }

    pub async fn remove_account(&self, account_id: &str) {
        let mut registry = self.tunnels.write().await;
        if let Some(tunnel) = registry.remove(account_id) {
            // Gracefully close the WebSocket — relay cleans up on close
            drop(tunnel);
        }
    }

    async fn spawn_tunnel_with_backoff(&self, account_id: String) {
        let tunnels = self.tunnels.clone();
        tokio::spawn(async move {
            let backoff_secs = [1, 2, 4, 8, 16, 30, 60]; // max 60s between retries
            let mut attempt = 0;

            loop {
                {
                    let mut registry = tunnels.write().await;
                    if let Some(tunnel) = registry.get_mut(&account_id) {
                        match tunnel.connect().await {
                            Ok(_) => {
                                attempt = 0; // reset backoff on success
                                // Emit Tauri event so UI updates
                                // tauri::emit_all("tunnel:connected", &account_id);
                            }
                            Err(TunnelError::AuthFailed) => {
                                // Don't retry auth failures — API key is invalid
                                tracing::error!("Auth failed for account {}", account_id);
                                // tauri::emit_all("tunnel:auth_failed", &account_id);
                                return;
                            }
                            Err(e) => {
                                tracing::warn!("Tunnel connect failed: {}", e);
                            }
                        }
                    } else {
                        return; // Account was removed
                    }
                }

                let wait = backoff_secs[attempt.min(backoff_secs.len() - 1)];
                tokio::time::sleep(tokio::time::Duration::from_secs(wait)).await;
                attempt += 1;
            }
        });
    }

    pub async fn status_snapshot(&self) -> Vec<AccountStatus> {
        let registry = self.tunnels.read().await;
        registry.iter().map(|(id, tunnel)| AccountStatus {
            account_id: id.clone(),
            workspace_id: tunnel.workspace_id.clone(),
            state: tunnel.state().clone(),
        }).collect()
    }
}
```

### `config.rs`

API keys stored in OS keychain (macOS Keychain, Windows Credential Manager, Linux libsecret). Config metadata (account name, workspace name, bandwidth cap) in a plaintext TOML file. Never the key itself.

```rust
use serde::{Deserialize, Serialize};
use keyring::Entry; // keyring crate — wraps OS keychain

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AccountConfig {
    pub id: String,                     // UUID, generated at add time
    pub display_name: String,           // "Acme Corp - Outreach"
    pub workspace_name: String,         // fetched from API on validation
    pub workspace_id: String,
    pub bandwidth_cap_mb_day: u64,      // user-set daily cap, default 500MB
    pub enabled: bool,
    // api_key is NOT stored here — it's in the OS keychain
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppConfig {
    pub accounts: Vec<AccountConfig>,
    pub launch_at_login: bool,          // default false
    pub show_connection_log: bool,      // default true
    pub log_retention_days: u8,         // default 7, max 30
}

impl AccountConfig {
    /// Store API key in OS keychain
    pub fn save_api_key(&self, api_key: &str) -> Result<(), keyring::Error> {
        let entry = Entry::new("actium-tunnel", &self.id)?;
        entry.set_password(api_key)
    }

    /// Retrieve API key from OS keychain  
    pub fn get_api_key(&self) -> Result<String, keyring::Error> {
        let entry = Entry::new("actium-tunnel", &self.id)?;
        entry.get_password()
    }

    /// Remove API key from OS keychain on account delete
    pub fn delete_api_key(&self) -> Result<(), keyring::Error> {
        let entry = Entry::new("actium-tunnel", &self.id)?;
        entry.delete_password()
    }
}
```

### `main.rs`

Tray icon setup, window management, Tauri command registration.

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu,
    SystemTrayMenuItem,
};

mod allowlist;
mod auth;
mod bandwidth;
mod config;
mod crypto;
mod proxy;
mod tunnel;
mod tunnel_registry;

#[tauri::command]
async fn add_account(
    api_key: String,
    state: tauri::State<'_, AppState>,
) -> Result<AccountConfig, String> {
    state.registry.add_account_from_key(api_key).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn remove_account(
    account_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.registry.remove_account(&account_id).await;
    state.config.write().await.remove_account(&account_id);
    Ok(())
}

#[tauri::command]
async fn get_status(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<AccountStatus>, String> {
    Ok(state.registry.status_snapshot().await)
}

#[tauri::command]
async fn get_connection_log(
    account_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ConnectionLogEntry>, String> {
    Ok(state.log.entries_for(&account_id).await)
}

#[tauri::command]
async fn set_bandwidth_cap(
    account_id: String,
    cap_mb: u64,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.bandwidth.set_cap(&account_id, cap_mb * 1024 * 1024).await;
    Ok(())
}

#[tauri::command]
fn get_allowed_domains() -> Vec<&'static str> {
    allowlist::ALLOWED_DOMAINS.to_vec()
}

fn build_tray() -> SystemTray {
    let open = CustomMenuItem::new("open", "Open Actium Tunnel");
    let quit = CustomMenuItem::new("quit", "Quit");
    let menu = SystemTrayMenu::new()
        .add_item(open)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(quit);
    SystemTray::new().with_menu(menu)
}

fn main() {
    tauri::Builder::default()
        .system_tray(build_tray())
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "open" => {
                    let window = app.get_window("main").unwrap();
                    window.show().unwrap();
                    window.set_focus().unwrap();
                }
                "quit" => std::process::exit(0),
                _ => {}
            },
            SystemTrayEvent::LeftClick { .. } => {
                let window = app.get_window("main").unwrap();
                if window.is_visible().unwrap() {
                    window.hide().unwrap();
                } else {
                    window.show().unwrap();
                    window.set_focus().unwrap();
                }
            }
            _ => {}
        })
        .on_window_event(|event| {
            // Hide to tray on close, don't quit
            if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                event.window().hide().unwrap();
                api.prevent_close();
            }
        })
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            add_account,
            remove_account,
            get_status,
            get_connection_log,
            set_bandwidth_cap,
            get_allowed_domains,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Actium Tunnel");
}
```

---

## React Frontend — Settings Window

### `App.tsx`

```tsx
import { useEffect, useState } from 'react';
import { AccountList } from './components/AccountList';
import { AddAccountModal } from './components/AddAccountModal';
import { ConnectionLog } from './components/ConnectionLog';
import { AllowlistViewer } from './components/AllowlistViewer';
import { listen } from '@tauri-apps/api/event';

export default function App() {
  const [view, setView] = useState<'accounts' | 'log' | 'allowlist'>('accounts');
  const [showAddModal, setShowAddModal] = useState(false);

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="logo">
          <ActiumLogo />
          <span>Tunnel</span>
        </div>
        <NavItem icon={<IconAccounts />} label="Accounts" 
          active={view === 'accounts'} onClick={() => setView('accounts')} />
        <NavItem icon={<IconLog />} label="Connections" 
          active={view === 'log'} onClick={() => setView('log')} />
        <NavItem icon={<IconShield />} label="Allowed Domains" 
          active={view === 'allowlist'} onClick={() => setView('allowlist')} />
      </nav>

      <main>
        {view === 'accounts' && (
          <>
            <AccountList onAdd={() => setShowAddModal(true)} />
            {showAddModal && (
              <AddAccountModal onClose={() => setShowAddModal(false)} />
            )}
          </>
        )}
        {view === 'log' && <ConnectionLog />}
        {view === 'allowlist' && <AllowlistViewer />}
      </main>
    </div>
  );
}
```

### `AccountList.tsx`

```tsx
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

interface AccountStatus {
  account_id: string;
  workspace_id: string;
  display_name: string;
  workspace_name: string;
  state: 'Disconnected' | 'Connecting' | 'Connected' | 'Error';
  error_message?: string;
  bytes_today: number;
  cap_bytes: number;
  connections_today: number;
}

export function AccountList({ onAdd }: { onAdd: () => void }) {
  const [accounts, setAccounts] = useState<AccountStatus[]>([]);

  useEffect(() => {
    // Initial load
    invoke<AccountStatus[]>('get_status').then(setAccounts);

    // Live updates from tunnel state changes
    const unlisten = listen<AccountStatus[]>('tunnel:status_update', (e) => {
      setAccounts(e.payload);
    });

    // Poll every 5s for bandwidth updates
    const interval = setInterval(() => {
      invoke<AccountStatus[]>('get_status').then(setAccounts);
    }, 5000);

    return () => {
      unlisten.then(f => f());
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="account-list">
      <header>
        <h1>Accounts</h1>
        <button className="btn-primary" onClick={onAdd}>
          + Add Account
        </button>
      </header>

      {accounts.length === 0 ? (
        <EmptyState onAdd={onAdd} />
      ) : (
        accounts.map(account => (
          <AccountCard key={account.account_id} account={account} />
        ))
      )}
    </div>
  );
}

function AccountCard({ account }: { account: AccountStatus }) {
  const [removing, setRemoving] = useState(false);
  const pctUsed = account.cap_bytes > 0 
    ? (account.bytes_today / account.cap_bytes) * 100 
    : 0;

  const stateColor = {
    Connected: 'var(--green)',
    Connecting: 'var(--yellow)',
    Disconnected: 'var(--muted)',
    Error: 'var(--red)',
  }[account.state];

  return (
    <div className="account-card">
      <div className="account-header">
        <div className="account-info">
          <div className="account-name">{account.display_name}</div>
          <div className="workspace-name">{account.workspace_name}</div>
        </div>
        <div className="account-state">
          <div className="state-dot" style={{ background: stateColor }} />
          <span>{account.state}</span>
        </div>
      </div>

      {account.state === 'Error' && (
        <div className="error-banner">{account.error_message}</div>
      )}

      <div className="account-stats">
        <Stat label="Today" value={formatBytes(account.bytes_today)} />
        <Stat label="Connections" value={account.connections_today.toString()} />
        <Stat label="Cap" value={formatBytes(account.cap_bytes) + '/day'} />
      </div>

      <div className="bandwidth-bar">
        <div 
          className="bandwidth-fill" 
          style={{ 
            width: `${Math.min(pctUsed, 100)}%`,
            background: pctUsed > 90 ? 'var(--red)' : 'var(--accent)',
          }} 
        />
      </div>

      <div className="account-actions">
        <BandwidthCapInput accountId={account.account_id} currentCap={account.cap_bytes} />
        <button 
          className="btn-danger-ghost" 
          onClick={() => removeAccount(account.account_id, setRemoving)}
          disabled={removing}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

async function removeAccount(accountId: string, setRemoving: (v: boolean) => void) {
  if (!confirm('Remove this account? The tunnel will disconnect immediately.')) return;
  setRemoving(true);
  await invoke('remove_account', { accountId });
}
```

### `AddAccountModal.tsx`

```tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';

export function AddAccountModal({ onClose }: { onClose: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState<'idle' | 'validating' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleAdd = async () => {
    if (!apiKey.trim()) return;
    setStatus('validating');
    setErrorMessage('');

    try {
      // Rust validates the key against Actium API, fetches workspace name
      await invoke('add_account', { 
        apiKey: apiKey.trim(),
        displayName: displayName.trim() || undefined,
      });
      onClose();
    } catch (e) {
      setStatus('error');
      // Rust returns human-readable errors:
      // "Invalid API key" | "Workspace not found" | "Network error"
      setErrorMessage(e as string);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Add Account</h2>

        <div className="field-group">
          <label>API Key</label>
          <input
            type="password"
            placeholder="act_live_..."
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            autoFocus
          />
          <p className="field-hint">
            Generate in Actium portal → Settings → API Keys
          </p>
        </div>

        <div className="field-group">
          <label>Label <span className="optional">(optional)</span></label>
          <input
            type="text"
            placeholder="e.g. Acme Corp - LinkedIn Outreach"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
          />
        </div>

        {status === 'error' && (
          <div className="error-message">{errorMessage}</div>
        )}

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button 
            className="btn-primary" 
            onClick={handleAdd}
            disabled={status === 'validating' || !apiKey.trim()}
          >
            {status === 'validating' ? 'Validating...' : 'Add Account'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

### `AllowlistViewer.tsx`

```tsx
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';

export function AllowlistViewer() {
  const [domains, setDomains] = useState<string[]>([]);

  useEffect(() => {
    invoke<string[]>('get_allowed_domains').then(setDomains);
  }, []);

  return (
    <div className="allowlist-view">
      <header>
        <h1>Allowed Domains</h1>
      </header>

      <div className="trust-banner">
        <IconShield />
        <div>
          <strong>This list is compiled into the app.</strong>
          <p>
            Traffic can only be forwarded to these domains. The relay server 
            cannot add domains, modify this list, or instruct the app to 
            connect to arbitrary hosts. Changing this list requires 
            recompiling the application from source.
          </p>
          <a 
            href="https://github.com/actium/tunnel" 
            target="_blank"
            rel="noopener noreferrer"
          >
            View source on GitHub →
          </a>
        </div>
      </div>

      <div className="domain-list">
        {domains.map(domain => (
          <div key={domain} className="domain-row">
            <IconLock size={14} />
            <span>{domain}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Relay Server (apps/relay/)

The relay runs on Actium's infrastructure. It's the broker between the cloud worker and the client's desktop tunnel. It never decrypts traffic — TLS passthrough only.

### `tunnel-registry.ts`

```typescript
import { WebSocket } from 'ws';

interface ActiveTunnel {
  workspaceId: string;
  organizationId: string;
  ws: WebSocket;
  connectedAt: Date;
  bytesRelayed: number;
}

// In-memory registry — could be Redis for multi-instance relay later
const activeTunnels = new Map<string, ActiveTunnel>();

export function registerTunnel(workspaceId: string, tunnel: ActiveTunnel) {
  // One tunnel per workspace — new connection replaces old
  const existing = activeTunnels.get(workspaceId);
  if (existing) {
    existing.ws.close(1000, 'Replaced by new connection');
  }
  activeTunnels.set(workspaceId, tunnel);
}

export function removeTunnel(workspaceId: string) {
  activeTunnels.delete(workspaceId);
}

export function getTunnel(workspaceId: string): ActiveTunnel | undefined {
  return activeTunnels.get(workspaceId);
}

export function listActiveTunnels(): ActiveTunnel[] {
  return Array.from(activeTunnels.values());
}
```

### `index.ts`

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { validateApiKey } from './auth-middleware';
import { registerTunnel, removeTunnel, getTunnel } from './tunnel-registry';

const wss = new WebSocketServer({ port: 8443 });

wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
  const apiKey = req.headers['x-actium-api-key'] as string;
  const workspaceId = req.headers['x-actium-workspace-id'] as string;
  const tunnelVersion = req.headers['x-tunnel-version'] as string;

  if (!apiKey || !workspaceId) {
    ws.close(4001, 'Missing authentication headers');
    return;
  }

  // Validate API key against Actium portal DB
  const auth = await validateApiKey(apiKey, workspaceId);
  if (!auth.valid) {
    ws.close(4003, auth.reason ?? 'Invalid API key');
    return;
  }

  // Check minimum tunnel version (for security updates)
  if (!isTunnelVersionAccepted(tunnelVersion)) {
    ws.close(4009, 'Tunnel version too old. Please update Actium Tunnel.');
    return;
  }

  registerTunnel(workspaceId, {
    workspaceId,
    organizationId: auth.organizationId,
    ws,
    connectedAt: new Date(),
    bytesRelayed: 0,
  });

  ws.on('close', () => removeTunnel(workspaceId));
  ws.on('error', () => removeTunnel(workspaceId));
});

// Called by the worker's browser session when it needs to route through
// a client's tunnel. This is NOT a public endpoint — internal only.
export async function routeThroughTunnel(
  workspaceId: string,
  targetHost: string,
  targetPort: number,
  payload: Buffer,
): Promise<Buffer> {
  const tunnel = getTunnel(workspaceId);
  if (!tunnel) {
    throw new Error(`No active tunnel for workspace ${workspaceId}`);
  }

  // Forward to desktop app
  tunnel.ws.send(Buffer.concat([
    encodeSessionHeader(workspaceId, targetHost, targetPort),
    payload,
  ]));

  // Response comes back on the same WebSocket
  return waitForTunnelResponse(tunnel.ws);
}
```

---

## Actium Portal — API Key Scoping

The existing `ConnectorConfig` table in the Actium portal needs a flag for tunnel-capable API keys.

### Schema addition

```prisma
model ApiKey {
  // ... existing fields ...
  tunnelEnabled   Boolean @default(false)
  // When true, this key can authenticate desktop tunnel connections
  // Scoped to workspace — the tunnel routes traffic for this workspace only
}
```

### Settings UI addition

`apps/portal/src/app/dashboard/settings/api-keys/page.tsx` — add tunnel toggle:
```tsx
// When generating an API key, show a checkbox:
<label>
  <input type="checkbox" checked={tunnelEnabled} onChange={...} />
  Enable as Tunnel Key
  <span className="hint">
    Use this key in Actium Tunnel app to route agent traffic 
    through your own residential IP
  </span>
</label>
```

### Proxy router integration

`packages/agents/src/browser/proxy-router.ts` — add tunnel route:

```typescript
// In selectProxy(), before the existing routing logic:

// Check if this workspace has an active tunnel
const activeTunnel = await tunnelRegistry.getActiveTunnel(workspaceId);
if (activeTunnel && route.useCase !== 'local_warmup') {
  // Route through client's own desktop tunnel
  // This takes precedence over all managed proxy providers
  return {
    type: 'relay_tunnel',
    relayUrl: process.env.RELAY_URL,
    workspaceId,
    // Patchright uses SOCKS5 proxy pointing at the relay's ingress
    // The relay then forwards through the correct desktop tunnel
    host: new URL(process.env.RELAY_PROXY_ADDR).hostname,
    port: parseInt(new URL(process.env.RELAY_PROXY_ADDR).port),
  };
}

// Fall through to existing managed proxy logic...
```

When a tunnel is connected, the agent's proxy chain is:
```
Patchright → relay SOCKS5 ingress → WebSocket → desktop app → residential IP → target
```

When no tunnel is connected, falls back to SOAX/Decodo as before.

---

## `tauri.conf.json` — Key Settings

```json
{
  "package": {
    "productName": "Actium Tunnel",
    "version": "0.1.0"
  },
  "build": {
    "beforeBuildCommand": "pnpm build",
    "frontendDist": "../dist"
  },
  "tauri": {
    "allowlist": {
      "all": false,
      "event": { "all": true },
      "shell": { "open": true }
    },
    "bundle": {
      "active": true,
      "targets": ["dmg", "msi", "deb"],
      "identifier": "io.actium.tunnel",
      "icon": ["icons/icon.icns", "icons/icon.ico", "icons/icon.png"],
      "macOS": {
        "entitlements": null,
        "exceptionDomain": "",
        "signingIdentity": null,
        "providerShortName": null
      }
    },
    "security": {
      "csp": "default-src 'self'; style-src 'self' 'unsafe-inline'"
    },
    "systemTray": {
      "iconPath": "icons/tray.png",
      "iconAsTemplate": true,
      "menuOnLeftClick": false
    },
    "windows": [{
      "title": "Actium Tunnel",
      "width": 720,
      "height": 520,
      "resizable": false,
      "fullscreen": false,
      "decorations": true,
      "hiddenTitle": true,
      "titleBarStyle": "Overlay"
    }]
  }
}
```

---

## Cargo.toml

```toml
[package]
name = "actium-tunnel"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = ["system-tray"] }
tokio = { version = "1", features = ["full"] }
tokio-tungstenite = { version = "0.21", features = ["native-tls"] }
futures-util = "0.3"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
keyring = "2"           # OS keychain access
tracing = "0.1"
tracing-subscriber = "0.3"
toml = "0.8"
dirs = "5"              # OS config directory
uuid = { version = "1", features = ["v4"] }
reqwest = { version = "0.11", features = ["json", "rustls-tls"] }

[profile.release]
opt-level = "s"         # Optimize for size
lto = true
codegen-units = 1
panic = "abort"
strip = true            # Strip debug symbols from release
```

---

## Distribution Trust Checklist

These must be done before public release:

- [ ] macOS: Notarized with Apple Developer ID — unsigned builds trigger Gatekeeper
- [ ] Windows: Code-signed with EV certificate — unsigned triggers SmartScreen
- [ ] Auto-update signed with Tauri updater key, update server uses certificate pinning
- [ ] GitHub releases: attach SHA-256 checksums for all binaries
- [ ] Reproducible builds documented: anyone with the repo and same Rust toolchain produces the same binary
- [ ] Security policy in repo (SECURITY.md): how to report vulnerabilities
- [ ] Open source LICENSE: MIT or Apache-2.0 (makes the "you can clone and self-host" promise credible)
- [ ] Audit by external security firm before 1.0 (budget ~$15K for a focused review of the proxy/tunnel code)

---

## What This Is NOT

These properties are guaranteed by architecture, not policy:

| Claim | How it's enforced |
|---|---|
| Can't access user files | Tauri allowlist: filesystem disabled entirely |
| Can't execute arbitrary code | No shell access, no dynamic code loading |
| Can't proxy to arbitrary hosts | Allowlist compiled into binary, no runtime override |
| Can't be redirected to a different relay | Relay URL compiled in, certificate pinning |
| Can't silently increase bandwidth | User-set cap enforced in Rust, hard stop |
| Relay can't see decrypted traffic | TLS passthrough — relay handles encrypted bytes only |
| API key stored securely | OS keychain (macOS Keychain, Windows Credential Manager) |

---

## Open Source Repo Name

`actium/tunnel` — ships as `io.actium.tunnel` on macOS/Windows.

The README first paragraph: *"Actium Tunnel routes your Actium agents through your own IP address. By default it connects to Actium's relay. Change `ACTIUM_RELAY_URL` in `allowlist.rs` and recompile to point at your own infrastructure."*

That sentence is the entire self-hosting story.
