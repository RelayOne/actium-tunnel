import { invoke } from "@tauri-apps/api/core";

export interface AccountConfig {
  id: string;
  display_name: string;
  workspace_name: string;
  workspace_id: string;
  bandwidth_cap_mb_day: number;
  enabled: boolean;
}

export interface AccountStatus {
  account_id: string;
  workspace_id: string;
  display_name: string;
  workspace_name: string;
  state: "Disconnected" | "Connecting" | "Connected" | "Error";
  error_message?: string;
  bytes_today: number;
  cap_bytes: number;
  connections_today: number;
  connected_at_ms?: number;
}

export interface ConnectionLogEntry {
  id: number;
  account_id: string;
  host: string;
  action: string;
  bytes: number;
  timestamp_ms: number;
  blocked: boolean;
}

export async function addAccount(
  apiKey: string,
  displayName?: string
): Promise<AccountConfig> {
  return invoke<AccountConfig>("add_account", {
    apiKey,
    displayName: displayName || null,
  });
}

export async function removeAccount(accountId: string): Promise<void> {
  return invoke("remove_account", { accountId });
}

export async function getStatus(): Promise<AccountStatus[]> {
  return invoke<AccountStatus[]>("get_status");
}

export async function getConnectionLog(
  accountId?: string
): Promise<ConnectionLogEntry[]> {
  return invoke<ConnectionLogEntry[]>("get_connection_log", {
    accountId: accountId || null,
  });
}

export async function setBandwidthCap(
  accountId: string,
  capMb: number
): Promise<void> {
  return invoke("set_bandwidth_cap", { accountId, capMb });
}

export async function getAllowedDomains(): Promise<string[]> {
  return invoke<string[]>("get_allowed_domains");
}

// ── Update commands ──

export interface UpdateInfo {
  version: string;
  notes: string;
  urgency: "security" | "required" | "recommended" | "optional";
  pub_date: string;
}

export async function checkUpdate(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>("check_update");
}

export async function installUpdate(): Promise<void> {
  return invoke("install_update");
}

export async function getAppVersion(): Promise<string> {
  return invoke<string>("get_app_version");
}

export async function restartApp(): Promise<void> {
  return invoke("restart_app");
}

// ── Crash / bug report commands ──

export interface CrashReport {
  message: string;
  location: string;
  timestamp: string;
  backtrace: string;
}

export async function getPreviousCrash(): Promise<CrashReport | null> {
  return invoke<CrashReport | null>("get_previous_crash");
}

export async function logFrontendError(
  message: string,
  stack: string,
  componentStack: string
): Promise<void> {
  return invoke("log_frontend_error", { message, stack, componentStack });
}

export async function buildBugReport(
  description: string,
  email?: string
): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("build_bug_report", {
    description,
    email: email || null,
  });
}
