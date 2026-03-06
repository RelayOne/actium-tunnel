use std::net::SocketAddr;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::allowlist::is_allowed;
use crate::bandwidth::BandwidthTracker;

pub const PROXY_BIND_ADDR: &str = "127.0.0.1"; // localhost ONLY — never 0.0.0.0

pub struct ProxyServer {
    port: u16,
    workspace_id: String,
    account_id: String,
    bandwidth: BandwidthTracker,
}

impl ProxyServer {
    pub fn new(
        port: u16,
        workspace_id: String,
        account_id: String,
        bandwidth: BandwidthTracker,
    ) -> Self {
        Self {
            port,
            workspace_id,
            account_id,
            bandwidth,
        }
    }

    pub async fn run(&self) -> Result<(), Box<dyn std::error::Error>> {
        let addr = SocketAddr::from(([127, 0, 0, 1], self.port));
        let listener = TcpListener::bind(addr).await?;
        tracing::info!(port = self.port, "SOCKS5 proxy listening");

        loop {
            let (socket, _) = listener.accept().await?;
            let workspace_id = self.workspace_id.clone();
            let account_id = self.account_id.clone();
            let bandwidth = self.bandwidth.clone();

            tokio::spawn(async move {
                if let Err(e) = handle_socks5(socket, workspace_id, account_id, bandwidth).await {
                    tracing::debug!("SOCKS5 connection error: {}", e);
                }
            });
        }
    }
}

async fn handle_socks5(
    mut stream: tokio::net::TcpStream,
    workspace_id: String,
    account_id: String,
    bandwidth: BandwidthTracker,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // SOCKS5 handshake
    let mut buf = [0u8; 2];
    stream.read_exact(&mut buf).await?;

    if buf[0] != 0x05 {
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

    if req[1] != 0x01 {
        // Only CONNECT supported
        stream
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await?;
        return Err("Only CONNECT command supported".into());
    }

    // Parse destination
    let (host, port) = parse_destination(&mut stream, req[3]).await?;

    // ALLOWLIST CHECK — the critical gate
    if !is_allowed(&host) {
        tracing::warn!(
            workspace_id = %workspace_id,
            host = %host,
            "BLOCKED: host not in allowlist"
        );
        stream
            .write_all(&[0x05, 0x02, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await?;
        return Ok(());
    }

    // Daily bandwidth cap check
    if bandwidth.is_cap_reached(&account_id).await {
        tracing::warn!(workspace_id = %workspace_id, "BLOCKED: daily bandwidth cap reached");
        stream
            .write_all(&[0x05, 0x02, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await?;
        return Ok(());
    }

    // Connect to destination
    let target_addr = format!("{}:{}", host, port);
    let target = tokio::net::TcpStream::connect(&target_addr)
        .await
        .map_err(|e| format!("Failed to connect to {}: {}", target_addr, e))?;

    // Send SOCKS5 success response
    stream
        .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        .await?;

    // Bidirectional copy with bandwidth tracking
    let bytes = bandwidth_copy(stream, target).await;
    bandwidth.record(&account_id, bytes).await;

    Ok(())
}

async fn parse_destination(
    stream: &mut tokio::net::TcpStream,
    atyp: u8,
) -> Result<(String, u16), Box<dyn std::error::Error + Send + Sync>> {
    match atyp {
        // IPv4
        0x01 => {
            let mut addr = [0u8; 4];
            stream.read_exact(&mut addr).await?;
            let mut port_buf = [0u8; 2];
            stream.read_exact(&mut port_buf).await?;
            let port = u16::from_be_bytes(port_buf);
            let host = format!("{}.{}.{}.{}", addr[0], addr[1], addr[2], addr[3]);
            Ok((host, port))
        }
        // Domain name
        0x03 => {
            let mut len = [0u8; 1];
            stream.read_exact(&mut len).await?;
            let mut domain = vec![0u8; len[0] as usize];
            stream.read_exact(&mut domain).await?;
            let mut port_buf = [0u8; 2];
            stream.read_exact(&mut port_buf).await?;
            let port = u16::from_be_bytes(port_buf);
            let host = String::from_utf8(domain)?;
            Ok((host, port))
        }
        // IPv6
        0x04 => {
            let mut addr = [0u8; 16];
            stream.read_exact(&mut addr).await?;
            let mut port_buf = [0u8; 2];
            stream.read_exact(&mut port_buf).await?;
            let port = u16::from_be_bytes(port_buf);
            let host = format!(
                "{:x}:{:x}:{:x}:{:x}:{:x}:{:x}:{:x}:{:x}",
                u16::from_be_bytes([addr[0], addr[1]]),
                u16::from_be_bytes([addr[2], addr[3]]),
                u16::from_be_bytes([addr[4], addr[5]]),
                u16::from_be_bytes([addr[6], addr[7]]),
                u16::from_be_bytes([addr[8], addr[9]]),
                u16::from_be_bytes([addr[10], addr[11]]),
                u16::from_be_bytes([addr[12], addr[13]]),
                u16::from_be_bytes([addr[14], addr[15]]),
            );
            Ok((host, port))
        }
        _ => Err(format!("Unsupported address type: {}", atyp).into()),
    }
}

async fn bandwidth_copy(
    mut client: tokio::net::TcpStream,
    mut target: tokio::net::TcpStream,
) -> u64 {
    let (mut cr, mut cw) = client.split();
    let (mut tr, mut tw) = target.split();

    let c2t = tokio::io::copy(&mut cr, &mut tw);
    let t2c = tokio::io::copy(&mut tr, &mut cw);

    match tokio::try_join!(c2t, t2c) {
        Ok((sent, received)) => sent + received,
        Err(_) => 0,
    }
}
