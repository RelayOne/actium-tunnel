use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::RwLock;

const MAX_LOG_ENTRIES: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionLogEntry {
    pub id: u64,
    pub account_id: String,
    pub host: String,
    pub action: String,
    pub bytes: u64,
    pub timestamp_ms: u64,
    pub blocked: bool,
}

#[derive(Clone)]
pub struct ConnectionLog {
    entries: Arc<RwLock<VecDeque<ConnectionLogEntry>>>,
    next_id: Arc<RwLock<u64>>,
}

impl ConnectionLog {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(RwLock::new(VecDeque::with_capacity(MAX_LOG_ENTRIES))),
            next_id: Arc::new(RwLock::new(1)),
        }
    }

    pub async fn add_entry(
        &self,
        account_id: &str,
        host: &str,
        action: &str,
        bytes: u64,
        blocked: bool,
    ) {
        let mut entries = self.entries.write().await;
        let mut id = self.next_id.write().await;

        let timestamp_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let entry = ConnectionLogEntry {
            id: *id,
            account_id: account_id.to_string(),
            host: host.to_string(),
            action: action.to_string(),
            bytes,
            timestamp_ms,
            blocked,
        };

        *id += 1;

        if entries.len() >= MAX_LOG_ENTRIES {
            entries.pop_front();
        }
        entries.push_back(entry);
    }

    pub async fn entries_for(&self, account_id: &str) -> Vec<ConnectionLogEntry> {
        let entries = self.entries.read().await;
        entries
            .iter()
            .filter(|e| e.account_id == account_id)
            .cloned()
            .collect()
    }

    pub async fn all_entries(&self) -> Vec<ConnectionLogEntry> {
        let entries = self.entries.read().await;
        entries.iter().cloned().collect()
    }
}
