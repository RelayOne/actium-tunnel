use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AccountConfig {
    pub id: String,
    pub display_name: String,
    pub workspace_name: String,
    pub workspace_id: String,
    pub bandwidth_cap_mb_day: u64,
    pub enabled: bool,
    // api_key is NOT stored here — it's in the OS keychain
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppConfig {
    pub accounts: Vec<AccountConfig>,
    pub launch_at_login: bool,
    pub show_connection_log: bool,
    pub log_retention_days: u8,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            accounts: Vec::new(),
            launch_at_login: false,
            show_connection_log: true,
            log_retention_days: 7,
        }
    }
}

impl AppConfig {
    pub fn config_path() -> PathBuf {
        let dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("actium-tunnel");
        std::fs::create_dir_all(&dir).ok();
        dir.join("config.toml")
    }

    pub fn load() -> Self {
        let path = Self::config_path();
        match std::fs::read_to_string(&path) {
            Ok(contents) => toml::from_str(&contents).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        let path = Self::config_path();
        let contents = toml::to_string_pretty(self)?;
        std::fs::write(path, contents)?;
        Ok(())
    }

    pub fn add_account(&mut self, account: AccountConfig) {
        // Remove existing account with same id if present
        self.accounts.retain(|a| a.id != account.id);
        self.accounts.push(account);
        self.save().ok();
    }

    pub fn remove_account(&mut self, account_id: &str) {
        self.accounts.retain(|a| a.id != account_id);
        self.save().ok();
    }

    pub fn get_account(&self, account_id: &str) -> Option<&AccountConfig> {
        self.accounts.iter().find(|a| a.id == account_id)
    }
}

impl AccountConfig {
    /// Store API key in OS keychain
    pub fn save_api_key(&self, api_key: &str) -> Result<(), keyring::Error> {
        let entry = keyring::Entry::new("actium-tunnel", &self.id)?;
        entry.set_password(api_key)
    }

    /// Retrieve API key from OS keychain
    pub fn get_api_key(&self) -> Result<String, keyring::Error> {
        let entry = keyring::Entry::new("actium-tunnel", &self.id)?;
        entry.get_password()
    }

    /// Remove API key from OS keychain on account delete
    pub fn delete_api_key(&self) -> Result<(), keyring::Error> {
        let entry = keyring::Entry::new("actium-tunnel", &self.id)?;
        entry.delete_credential()
    }
}
