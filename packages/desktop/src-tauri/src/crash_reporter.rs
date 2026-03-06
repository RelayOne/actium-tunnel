use serde::{Deserialize, Serialize};
use std::panic;
use std::path::PathBuf;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrashReport {
    #[serde(rename = "type")]
    pub crash_type: String,
    pub message: String,
    pub location: String,
    pub app_version: String,
    pub os: String,
    pub arch: String,
    pub timestamp: String,
}

/// Install a custom panic hook that writes a crash file before the process dies.
pub fn install_panic_hook(app_handle: tauri::AppHandle) {
    let handle = app_handle.clone();

    panic::set_hook(Box::new(move |info| {
        let payload = info.payload();
        let message = if let Some(s) = payload.downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = payload.downcast_ref::<String>() {
            s.clone()
        } else {
            "Unknown panic".to_string()
        };

        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();

        let crash_report = CrashReport {
            crash_type: "panic".to_string(),
            message: message.clone(),
            location: location.clone(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            timestamp: now.to_string(),
        };

        // Write to crash file — survives the process dying
        if let Some(crash_path) = crash_file_path() {
            if let Some(parent) = crash_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(json) = serde_json::to_string_pretty(&crash_report) {
                let _ = std::fs::write(&crash_path, json);
            }
        }

        // Attempt to emit event to frontend before dying
        let _ = handle.emit("app:panic", &crash_report);

        tracing::error!(
            message = %message,
            location = %location,
            "PANIC: application crashed"
        );
    }));
}

/// Check for a crash file from the previous run.
/// Returns the crash report and deletes the file.
pub fn check_for_previous_crash() -> Option<CrashReport> {
    let crash_path = crash_file_path()?;

    if !crash_path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&crash_path).ok()?;
    let report: CrashReport = serde_json::from_str(&content).ok()?;

    // Delete the crash file — we've consumed it
    let _ = std::fs::remove_file(&crash_path);

    Some(report)
}

fn crash_file_path() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("actium-tunnel").join("last_crash.json"))
}

/// Log a frontend error to the crash file system so it can be included in reports.
pub fn log_frontend_error(message: &str, stack: &str, component_stack: &str) {
    tracing::error!(
        message = %message,
        stack = %stack,
        component_stack = %component_stack,
        "Frontend error"
    );
}
