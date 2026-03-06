use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

const DEFAULT_DAILY_CAP: u64 = 500 * 1024 * 1024; // 500 MB

#[derive(Debug, Clone)]
pub struct BandwidthTracker {
    inner: Arc<RwLock<BandwidthInner>>,
}

#[derive(Debug)]
struct BandwidthInner {
    /// Per-account byte counts for the current day
    usage: HashMap<String, u64>,
    /// Per-account daily caps in bytes
    caps: HashMap<String, u64>,
    /// The date (as day-of-year) when usage was last reset
    reset_day: u32,
}

impl BandwidthTracker {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(BandwidthInner {
                usage: HashMap::new(),
                caps: HashMap::new(),
                reset_day: current_day(),
            })),
        }
    }

    pub async fn record(&self, account_id: &str, bytes: u64) {
        let mut inner = self.inner.write().await;
        inner.maybe_reset();
        *inner.usage.entry(account_id.to_string()).or_insert(0) += bytes;
    }

    pub async fn is_cap_reached(&self, account_id: &str) -> bool {
        let inner = self.inner.read().await;
        let used = inner.usage.get(account_id).copied().unwrap_or(0);
        let cap = inner.caps.get(account_id).copied().unwrap_or(DEFAULT_DAILY_CAP);
        used >= cap
    }

    pub async fn set_cap(&self, account_id: &str, cap_bytes: u64) {
        let mut inner = self.inner.write().await;
        inner.caps.insert(account_id.to_string(), cap_bytes);
    }

    pub async fn get_usage(&self, account_id: &str) -> u64 {
        let inner = self.inner.read().await;
        inner.usage.get(account_id).copied().unwrap_or(0)
    }

    pub async fn get_cap(&self, account_id: &str) -> u64 {
        let inner = self.inner.read().await;
        inner.caps.get(account_id).copied().unwrap_or(DEFAULT_DAILY_CAP)
    }

    pub async fn remove_account(&self, account_id: &str) {
        let mut inner = self.inner.write().await;
        inner.usage.remove(account_id);
        inner.caps.remove(account_id);
    }
}

impl BandwidthInner {
    fn maybe_reset(&mut self) {
        let today = current_day();
        if today != self.reset_day {
            self.usage.clear();
            self.reset_day = today;
        }
    }
}

fn current_day() -> u32 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Days since epoch
    (secs / 86400) as u32
}
