use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::auth;
use crate::bandwidth::BandwidthTracker;
use crate::config::{AccountConfig, AppConfig};
use crate::connection_log::ConnectionLog;
use crate::tunnel::{Tunnel, TunnelError, TunnelState};

#[derive(Debug, Clone, serde::Serialize)]
pub struct AccountStatus {
    pub account_id: String,
    pub workspace_id: String,
    pub display_name: String,
    pub workspace_name: String,
    pub state: String,
    pub error_message: Option<String>,
    pub bytes_today: u64,
    pub cap_bytes: u64,
    pub connections_today: u64,
    pub connected_at_ms: Option<u64>,
}

pub struct TunnelRegistry {
    tunnels: Arc<RwLock<HashMap<String, Tunnel>>>,
    bandwidth: BandwidthTracker,
    connection_log: ConnectionLog,
    connections_count: Arc<RwLock<HashMap<String, u64>>>,
}

impl TunnelRegistry {
    pub fn new(bandwidth: BandwidthTracker, connection_log: ConnectionLog) -> Self {
        Self {
            tunnels: Arc::new(RwLock::new(HashMap::new())),
            bandwidth,
            connection_log,
            connections_count: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn add_account(
        &self,
        api_key: &str,
        display_name: Option<String>,
        config: &Arc<RwLock<AppConfig>>,
    ) -> Result<AccountConfig, String> {
        // Validate API key against Actium portal
        let validation = auth::validate_api_key(api_key)
            .await
            .map_err(|e| e.to_string())?;

        let workspace_id = validation
            .workspace_id
            .ok_or("No workspace ID returned")?;
        let workspace_name = validation
            .workspace_name
            .unwrap_or_else(|| "Default Workspace".to_string());

        let account_id = uuid::Uuid::new_v4().to_string();
        let display = display_name.unwrap_or_else(|| workspace_name.clone());

        let account_config = AccountConfig {
            id: account_id.clone(),
            display_name: display,
            workspace_name,
            workspace_id: workspace_id.clone(),
            bandwidth_cap_mb_day: 500,
            enabled: true,
        };

        // Save API key to OS keychain
        account_config
            .save_api_key(api_key)
            .map_err(|e| format!("Failed to save API key: {}", e))?;

        // Save account config
        {
            let mut cfg = config.write().await;
            cfg.add_account(account_config.clone());
        }

        // Create and start tunnel
        let tunnel = Tunnel::new(
            account_id.clone(),
            workspace_id,
            api_key.to_string(),
            self.bandwidth.clone(),
            self.connection_log.clone(),
        );

        {
            let mut registry = self.tunnels.write().await;
            registry.insert(account_id.clone(), tunnel);
        }

        // Start connection with backoff
        self.spawn_tunnel_with_backoff(account_id).await;

        Ok(account_config)
    }

    pub async fn remove_account(&self, account_id: &str) {
        let mut registry = self.tunnels.write().await;
        if let Some(mut tunnel) = registry.remove(account_id) {
            tunnel.disconnect().await;
        }
        self.bandwidth.remove_account(account_id).await;
        self.connections_count
            .write()
            .await
            .remove(account_id);
    }

    async fn spawn_tunnel_with_backoff(&self, account_id: String) {
        let tunnels = self.tunnels.clone();
        tokio::spawn(async move {
            let backoff_secs = [1, 2, 4, 8, 16, 30, 60];
            let mut attempt = 0;

            loop {
                {
                    let mut registry = tunnels.write().await;
                    if let Some(tunnel) = registry.get_mut(&account_id) {
                        match tunnel.connect().await {
                            Ok(_) => {
                                tracing::info!(account_id = %account_id, "Tunnel connected");
                                attempt = 0;
                                // Wait for disconnection before retrying
                                drop(registry);
                                // Wait for the tunnel to disconnect
                                loop {
                                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                                    let reg = tunnels.read().await;
                                    if let Some(t) = reg.get(&account_id) {
                                        let state = t.get_state().await;
                                        if state == TunnelState::Disconnected {
                                            break;
                                        }
                                        if let TunnelState::Error { .. } = state {
                                            break;
                                        }
                                    } else {
                                        return; // Account was removed
                                    }
                                }
                            }
                            Err(TunnelError::AuthFailed) => {
                                tracing::error!(account_id = %account_id, "Auth failed, not retrying");
                                return;
                            }
                            Err(e) => {
                                tracing::warn!(account_id = %account_id, "Tunnel connect failed: {}", e);
                            }
                        }
                    } else {
                        return; // Account was removed
                    }
                }

                let wait = backoff_secs[attempt.min(backoff_secs.len() - 1)];
                tracing::debug!(account_id = %account_id, wait_secs = wait, "Reconnecting...");
                tokio::time::sleep(tokio::time::Duration::from_secs(wait)).await;
                attempt += 1;
            }
        });
    }

    pub async fn status_snapshot(
        &self,
        config: &Arc<RwLock<AppConfig>>,
    ) -> Vec<AccountStatus> {
        let registry = self.tunnels.read().await;
        let cfg = config.read().await;
        let conns = self.connections_count.read().await;

        let mut statuses = Vec::new();
        for account_cfg in &cfg.accounts {
            let (state_str, error_msg, connected_at_ms) =
                if let Some(tunnel) = registry.get(&account_cfg.id) {
                    let state = tunnel.get_state().await;
                    match &state {
                        TunnelState::Disconnected => {
                            ("Disconnected".to_string(), None, None)
                        }
                        TunnelState::Connecting => {
                            ("Connecting".to_string(), None, None)
                        }
                        TunnelState::Connected { connected_at_ms, .. } => {
                            ("Connected".to_string(), None, Some(*connected_at_ms))
                        }
                        TunnelState::Error { message } => {
                            ("Error".to_string(), Some(message.clone()), None)
                        }
                    }
                } else {
                    ("Disconnected".to_string(), None, None)
                };

            let bytes_today = self.bandwidth.get_usage(&account_cfg.id).await;
            let cap_bytes = self.bandwidth.get_cap(&account_cfg.id).await;
            let connections_today = conns.get(&account_cfg.id).copied().unwrap_or(0);

            statuses.push(AccountStatus {
                account_id: account_cfg.id.clone(),
                workspace_id: account_cfg.workspace_id.clone(),
                display_name: account_cfg.display_name.clone(),
                workspace_name: account_cfg.workspace_name.clone(),
                state: state_str,
                error_message: error_msg,
                bytes_today,
                cap_bytes,
                connections_today,
                connected_at_ms,
            });
        }

        statuses
    }

    /// Restore tunnels from saved config on app startup
    pub async fn restore_from_config(&self, config: &Arc<RwLock<AppConfig>>) {
        let cfg = config.read().await;
        let accounts: Vec<AccountConfig> = cfg
            .accounts
            .iter()
            .filter(|a| a.enabled)
            .cloned()
            .collect();
        drop(cfg);

        for account in accounts {
            let api_key = match account.get_api_key() {
                Ok(key) => key,
                Err(e) => {
                    tracing::warn!(
                        account_id = %account.id,
                        "Failed to retrieve API key from keychain: {}", e
                    );
                    continue;
                }
            };

            // Set bandwidth cap
            self.bandwidth
                .set_cap(
                    &account.id,
                    account.bandwidth_cap_mb_day * 1024 * 1024,
                )
                .await;

            let tunnel = Tunnel::new(
                account.id.clone(),
                account.workspace_id.clone(),
                api_key,
                self.bandwidth.clone(),
                self.connection_log.clone(),
            );

            {
                let mut registry = self.tunnels.write().await;
                registry.insert(account.id.clone(), tunnel);
            }

            self.spawn_tunnel_with_backoff(account.id).await;
        }
    }
}
