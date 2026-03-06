use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::tungstenite::handshake::client::Request;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

use crate::allowlist::is_allowed;
use crate::bandwidth::BandwidthTracker;
use crate::connection_log::ConnectionLog;

/// The Actium relay URL. Hardcoded intentionally.
/// Self-hosters: change this constant and recompile.
pub const ACTIUM_RELAY_URL: &str = "wss://relay.actium.io/tunnel";

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub enum TunnelState {
    Disconnected,
    Connecting,
    Connected {
        #[serde(skip)]
        connected_at: Option<std::time::Instant>,
        connected_at_ms: u64,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum TunnelError {
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),

    #[error("Authentication failed")]
    AuthFailed,

    #[error("WebSocket error: {0}")]
    WebSocketError(String),
}

pub struct Tunnel {
    pub workspace_id: String,
    pub api_key: String,
    pub account_id: String,
    pub state: Arc<RwLock<TunnelState>>,
    pub bandwidth: BandwidthTracker,
    pub connection_log: ConnectionLog,
    shutdown_tx: Option<mpsc::Sender<()>>,
}

impl Tunnel {
    pub fn new(
        account_id: String,
        workspace_id: String,
        api_key: String,
        bandwidth: BandwidthTracker,
        connection_log: ConnectionLog,
    ) -> Self {
        Self {
            workspace_id,
            api_key,
            account_id,
            state: Arc::new(RwLock::new(TunnelState::Disconnected)),
            bandwidth,
            connection_log,
            shutdown_tx: None,
        }
    }

    pub async fn connect(&mut self) -> Result<(), TunnelError> {
        *self.state.write().await = TunnelState::Connecting;

        let uri = format!(
            "{}?workspace_id={}&version={}",
            ACTIUM_RELAY_URL,
            self.workspace_id,
            env!("CARGO_PKG_VERSION")
        );

        let request = Request::builder()
            .uri(&uri)
            .header("X-Actium-Api-Key", &self.api_key)
            .header("X-Actium-Workspace-Id", &self.workspace_id)
            .header("X-Tunnel-Version", env!("CARGO_PKG_VERSION"))
            .header("Host", "relay.actium.io")
            .header("Connection", "Upgrade")
            .header("Upgrade", "websocket")
            .header("Sec-WebSocket-Version", "13")
            .header(
                "Sec-WebSocket-Key",
                tokio_tungstenite::tungstenite::handshake::client::generate_key(),
            )
            .body(())
            .map_err(|e| TunnelError::ConnectionFailed(e.to_string()))?;

        let (ws_stream, _response) = connect_async(request)
            .await
            .map_err(|e| {
                let msg = e.to_string();
                if msg.contains("401") || msg.contains("403") || msg.contains("Unauthorized") {
                    TunnelError::AuthFailed
                } else {
                    TunnelError::ConnectionFailed(msg)
                }
            })?;

        let now = std::time::Instant::now();
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        *self.state.write().await = TunnelState::Connected {
            connected_at: Some(now),
            connected_at_ms: now_ms,
        };

        let (shutdown_tx, shutdown_rx) = mpsc::channel(1);
        self.shutdown_tx = Some(shutdown_tx);

        let state = self.state.clone();
        let workspace_id = self.workspace_id.clone();
        let account_id = self.account_id.clone();
        let bandwidth = self.bandwidth.clone();
        let log = self.connection_log.clone();

        tokio::spawn(async move {
            tunnel_message_loop(ws_stream, workspace_id, account_id, bandwidth, log, shutdown_rx, state)
                .await;
        });

        Ok(())
    }

    pub async fn disconnect(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(()).await;
        }
        *self.state.write().await = TunnelState::Disconnected;
    }

    pub async fn get_state(&self) -> TunnelState {
        self.state.read().await.clone()
    }
}

impl Drop for Tunnel {
    fn drop(&mut self) {
        // Signal shutdown when tunnel is dropped
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.try_send(());
        }
    }
}

async fn tunnel_message_loop(
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    workspace_id: String,
    account_id: String,
    bandwidth: BandwidthTracker,
    log: ConnectionLog,
    mut shutdown_rx: mpsc::Receiver<()>,
    state: Arc<RwLock<TunnelState>>,
) {
    let (mut ws_sink, mut ws_stream) = ws.split();

    loop {
        tokio::select! {
            _ = shutdown_rx.recv() => {
                let _ = ws_sink.send(Message::Close(None)).await;
                break;
            }
            msg = ws_stream.next() => {
                match msg {
                    Some(Ok(Message::Binary(data))) => {
                        if let Some(response) = handle_proxy_payload(&data, &workspace_id, &account_id, &bandwidth, &log).await {
                            if let Err(e) = ws_sink.send(Message::Binary(response)).await {
                                tracing::error!(workspace_id = %workspace_id, "Failed to send response: {}", e);
                                *state.write().await = TunnelState::Error {
                                    message: TunnelError::WebSocketError(e.to_string()).to_string(),
                                };
                                return;
                            }
                        }
                    }
                    Some(Ok(Message::Ping(p))) => {
                        let _ = ws_sink.send(Message::Pong(p)).await;
                    }
                    Some(Ok(Message::Close(_))) => {
                        tracing::info!(workspace_id = %workspace_id, "Tunnel closed by relay");
                        break;
                    }
                    Some(Err(e)) => {
                        tracing::error!(workspace_id = %workspace_id, "WebSocket error: {}", e);
                        *state.write().await = TunnelState::Error {
                            message: e.to_string(),
                        };
                        return;
                    }
                    None => {
                        tracing::info!(workspace_id = %workspace_id, "WebSocket stream ended");
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    *state.write().await = TunnelState::Disconnected;
}

/// Handle an incoming proxy request from the relay.
/// Format: [4-byte session-id][2-byte target-port][target-host-null-terminated][payload]
async fn handle_proxy_payload(
    data: &[u8],
    workspace_id: &str,
    account_id: &str,
    bandwidth: &BandwidthTracker,
    log: &ConnectionLog,
) -> Option<Vec<u8>> {
    if data.len() < 7 {
        tracing::warn!("Payload too short");
        return None;
    }

    // Parse session ID (first 4 bytes)
    let session_id = &data[0..4];

    // Parse target port (next 2 bytes, big-endian)
    let target_port = u16::from_be_bytes([data[4], data[5]]);

    // Parse target host (null-terminated string starting at byte 6)
    let host_start = 6;
    let host_end = data[host_start..]
        .iter()
        .position(|&b| b == 0)
        .map(|p| host_start + p)?;
    let target_host = std::str::from_utf8(&data[host_start..host_end]).ok()?;

    // Payload starts after the null terminator
    let payload = &data[host_end + 1..];

    // Allowlist check
    if !is_allowed(target_host) {
        tracing::warn!(
            workspace_id = %workspace_id,
            host = %target_host,
            "BLOCKED: host not in allowlist"
        );
        log.add_entry(account_id, target_host, "CONNECT", 0, true).await;
        let mut resp = Vec::with_capacity(5);
        resp.extend_from_slice(session_id);
        resp.push(0x01); // error: blocked
        return Some(resp);
    }

    // Bandwidth cap check
    if bandwidth.is_cap_reached(account_id).await {
        tracing::warn!(workspace_id = %workspace_id, "BLOCKED: daily bandwidth cap reached");
        log.add_entry(account_id, target_host, "CAP_REACHED", 0, true).await;
        let mut resp = Vec::with_capacity(5);
        resp.extend_from_slice(session_id);
        resp.push(0x02); // error: bandwidth cap
        return Some(resp);
    }

    // Connect to target and forward payload
    let target_addr = format!("{}:{}", target_host, target_port);
    match tokio::net::TcpStream::connect(&target_addr).await {
        Ok(mut target_stream) => {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};

            // Send payload to target
            if let Err(e) = target_stream.write_all(payload).await {
                tracing::debug!("Failed to write to target: {}", e);
                let mut resp = Vec::with_capacity(5);
                resp.extend_from_slice(session_id);
                resp.push(0x03); // error: connection failed
                return Some(resp);
            }

            // Read response from target
            let mut response_buf = vec![0u8; 65536];
            match target_stream.read(&mut response_buf).await {
                Ok(n) => {
                    let bytes_total = (payload.len() + n) as u64;
                    bandwidth.record(account_id, bytes_total).await;
                    log.add_entry(account_id, target_host, "CONNECT", bytes_total, false).await;

                    // Build response: session_id + 0x00 (success) + response data
                    let mut resp = Vec::with_capacity(5 + n);
                    resp.extend_from_slice(session_id);
                    resp.push(0x00); // success
                    resp.extend_from_slice(&response_buf[..n]);
                    Some(resp)
                }
                Err(e) => {
                    tracing::debug!("Failed to read from target: {}", e);
                    let mut resp = Vec::with_capacity(5);
                    resp.extend_from_slice(session_id);
                    resp.push(0x03);
                    Some(resp)
                }
            }
        }
        Err(e) => {
            tracing::debug!("Failed to connect to {}: {}", target_addr, e);
            let mut resp = Vec::with_capacity(5);
            resp.extend_from_slice(session_id);
            resp.push(0x03); // error: connection failed
            Some(resp)
        }
    }
}
