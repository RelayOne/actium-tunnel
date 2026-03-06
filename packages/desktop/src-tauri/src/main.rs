#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use tokio::sync::RwLock;

mod allowlist;
mod auth;
mod bandwidth;
mod config;
mod connection_log;
mod crash_reporter;
mod log_sanitiser;
#[allow(dead_code)]
mod proxy;
mod tunnel;
mod tunnel_registry;
mod updater;

use bandwidth::BandwidthTracker;
use config::{AccountConfig, AppConfig};
use connection_log::{ConnectionLog, ConnectionLogEntry};
use crash_reporter::CrashReport;
use tunnel_registry::{AccountStatus, TunnelRegistry};
use updater::UpdateInfo;

struct AppState {
    registry: TunnelRegistry,
    config: Arc<RwLock<AppConfig>>,
    log: ConnectionLog,
    bandwidth: BandwidthTracker,
}

impl AppState {
    fn new() -> Self {
        let bandwidth = BandwidthTracker::new();
        let log = ConnectionLog::new();
        Self {
            registry: TunnelRegistry::new(bandwidth.clone(), log.clone()),
            config: Arc::new(RwLock::new(AppConfig::load())),
            log,
            bandwidth,
        }
    }
}

// ── Account commands ──

#[tauri::command]
async fn add_account(
    api_key: String,
    display_name: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<AccountConfig, String> {
    state
        .registry
        .add_account(&api_key, display_name, &state.config)
        .await
}

#[tauri::command]
async fn remove_account(
    account_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.registry.remove_account(&account_id).await;

    let cfg = state.config.read().await;
    if let Some(account) = cfg.get_account(&account_id) {
        let _ = account.delete_api_key();
    }
    drop(cfg);

    state.config.write().await.remove_account(&account_id);
    Ok(())
}

#[tauri::command]
async fn get_status(state: tauri::State<'_, AppState>) -> Result<Vec<AccountStatus>, String> {
    Ok(state.registry.status_snapshot(&state.config).await)
}

#[tauri::command]
async fn get_connection_log(
    account_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ConnectionLogEntry>, String> {
    match account_id {
        Some(id) => Ok(state.log.entries_for(&id).await),
        None => Ok(state.log.all_entries().await),
    }
}

#[tauri::command]
async fn set_bandwidth_cap(
    account_id: String,
    cap_mb: u64,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .bandwidth
        .set_cap(&account_id, cap_mb * 1024 * 1024)
        .await;

    let mut cfg = state.config.write().await;
    if let Some(account) = cfg.accounts.iter_mut().find(|a| a.id == account_id) {
        account.bandwidth_cap_mb_day = cap_mb;
    }
    cfg.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_allowed_domains() -> Vec<&'static str> {
    allowlist::ALLOWED_DOMAINS.to_vec()
}

// ── Update commands ──

#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    updater::check_for_update(&app).await
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    updater::download_and_install(&app).await
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

// ── Crash / bug report commands ──

#[tauri::command]
fn get_previous_crash() -> Option<CrashReport> {
    crash_reporter::check_for_previous_crash()
}

#[tauri::command]
fn log_frontend_error(message: String, stack: String, component_stack: String) {
    crash_reporter::log_frontend_error(&message, &stack, &component_stack);
}

/// Build a bug report payload with sanitised logs, for the user to preview
/// before sending.
#[tauri::command]
async fn build_bug_report(
    description: String,
    email: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let accounts = state.registry.status_snapshot(&state.config).await;

    let tunnel_states: Vec<serde_json::Value> = accounts
        .iter()
        .map(|a| {
            serde_json::json!({
                "state": a.state,
                "error_message": a.error_message,
            })
        })
        .collect();

    let log_entries = state.log.all_entries().await;
    let recent_logs: Vec<String> = log_entries
        .iter()
        .rev()
        .take(50)
        .map(|e| format!("[{}] {} {}", e.action, e.host, if e.blocked { "(blocked)" } else { "" }))
        .collect();
    let sanitised_logs = log_sanitiser::sanitise_log_lines(&recent_logs);

    let connected_count = accounts.iter().filter(|a| a.state == "Connected").count();

    let report = serde_json::json!({
        "app_version": env!("CARGO_PKG_VERSION"),
        "os": format!("{} ({})", std::env::consts::OS, std::env::consts::ARCH),
        "active_account_count": accounts.len(),
        "connected_tunnel_count": connected_count,
        "tunnel_states": tunnel_states,
        "description": description,
        "recent_logs": sanitised_logs,
        "email": email,
    });

    Ok(report)
}

// ── Main ──

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("actium_tunnel=info".parse().unwrap()),
        )
        .init();

    let app_state = AppState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            use tauri::Manager;
            use tauri::menu::{MenuBuilder, MenuItemBuilder};
            use tauri::tray::TrayIconBuilder;

            // Install crash reporter panic hook
            crash_reporter::install_panic_hook(app.handle().clone());

            // Build tray menu
            let open_item = MenuItemBuilder::with_id("open", "Open Actium Tunnel")
                .build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit")
                .build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&open_item)
                .separator()
                .item(&quit_item)
                .build()?;

            // Build tray icon
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Actium Tunnel")
                .on_menu_event(move |app: &tauri::AppHandle, event: tauri::menu::MenuEvent| {
                    match event.id().as_ref() {
                        "open" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event: tauri::tray::TrayIconEvent| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Start background update checker
            updater::spawn_update_checker(app.handle().clone());

            // Restore tunnels from saved config
            let state: tauri::State<AppState> = app.state();
            let config = state.config.clone();
            let registry_ref = &state.registry;
            let config_ref = config.clone();
            tauri::async_runtime::block_on(async move {
                registry_ref.restore_from_config(&config_ref).await;
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide to tray on close, don't quit
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // Account commands
            add_account,
            remove_account,
            get_status,
            get_connection_log,
            set_bandwidth_cap,
            get_allowed_domains,
            // Update commands
            check_update,
            install_update,
            get_app_version,
            restart_app,
            // Crash / bug report commands
            get_previous_crash,
            log_frontend_error,
            build_bug_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Actium Tunnel");
}
