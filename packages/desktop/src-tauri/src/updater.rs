use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Emitter;
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    /// "security" | "required" | "recommended" | "optional"
    pub urgency: String,
    pub pub_date: String,
}

/// Check for updates using the Tauri updater plugin.
/// Called:
/// 1. At app launch (after 5s delay)
/// 2. Every 4 hours while running
/// 3. Immediately on relay 4009 rejection
pub async fn check_for_update(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    let update = updater.check().await.map_err(|e| e.to_string())?;

    match update {
        Some(update) => {
            let raw_body = update.body.clone().unwrap_or_default();
            let (urgency, clean_notes) = parse_notes(&raw_body);

            Ok(Some(UpdateInfo {
                version: update.version.clone(),
                notes: clean_notes,
                urgency,
                pub_date: update.date.clone().map(|d| d.to_string()).unwrap_or_default(),
            }))
        }
        None => Ok(None),
    }
}

/// Download and install the update. Tauri stages it for next launch.
pub async fn download_and_install(app: &AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("No update available")?;

    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    // Notify frontend that the update is staged and ready
    let _ = app.emit("update:ready_to_install", ());
    Ok(())
}

/// Parse notes field. If it starts with a JSON line containing "urgency",
/// extract that and return the rest as clean notes.
/// e.g. `{"urgency":"security"}\nSecurity fix: ...`
fn parse_notes(raw: &str) -> (String, String) {
    if raw.starts_with('{') {
        if let Some(end) = raw.find('\n') {
            if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&raw[..end]) {
                let urgency = meta["urgency"]
                    .as_str()
                    .unwrap_or("recommended")
                    .to_string();
                let notes = raw[end + 1..].trim().to_string();
                return (urgency, notes);
            }
        }
    }
    ("recommended".to_string(), raw.to_string())
}

/// Spawn a background task that checks for updates periodically.
pub fn spawn_update_checker(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Initial delay — let the UI render first
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

        loop {
            match check_for_update(&app).await {
                Ok(Some(info)) => {
                    tracing::info!(version = %info.version, urgency = %info.urgency, "Update available");
                    let _ = app.emit("update:available", &info);
                }
                Ok(None) => {
                    tracing::debug!("No update available");
                }
                Err(e) => {
                    tracing::warn!("Update check failed: {}", e);
                }
            }

            // Check every 4 hours
            tokio::time::sleep(tokio::time::Duration::from_secs(4 * 60 * 60)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_notes_with_urgency() {
        let raw = "{\"urgency\":\"security\"}\nSecurity fix: tightened SOCKS5 validation.";
        let (urgency, notes) = parse_notes(raw);
        assert_eq!(urgency, "security");
        assert_eq!(notes, "Security fix: tightened SOCKS5 validation.");
    }

    #[test]
    fn test_parse_notes_plain() {
        let raw = "Just a normal update note.";
        let (urgency, notes) = parse_notes(raw);
        assert_eq!(urgency, "recommended");
        assert_eq!(notes, "Just a normal update note.");
    }

    #[test]
    fn test_parse_notes_empty() {
        let (urgency, notes) = parse_notes("");
        assert_eq!(urgency, "recommended");
        assert_eq!(notes, "");
    }
}
