import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AccountList } from "./components/AccountList";
import { AddAccountModal } from "./components/AddAccountModal";
import { ConnectionLog } from "./components/ConnectionLog";
import { AllowlistViewer } from "./components/AllowlistViewer";
import { AboutScreen } from "./components/AboutScreen";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { BugReportModal } from "./components/BugReportModal";
import {
  CrashRecoveryScreen,
  type CrashReport,
} from "./components/CrashRecoveryScreen";
import { useTunnelStatus } from "./hooks/useTunnelStatus";
import "./styles.css";

type View = "accounts" | "log" | "allowlist" | "about";

export default function App() {
  const [view, setView] = useState<View>("accounts");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBugReport, setShowBugReport] = useState(false);
  const [bugReportPrefill, setBugReportPrefill] = useState<{
    error?: string;
    context?: string;
  }>();
  const [previousCrash, setPreviousCrash] = useState<CrashReport | null>(null);
  const [crashDismissed, setCrashDismissed] = useState(false);
  const { accounts, refresh } = useTunnelStatus();

  const connectedCount = accounts.filter(
    (a) => a.state === "Connected"
  ).length;
  const totalBytes = accounts.reduce((s, a) => s + a.bytes_today, 0);

  // Check for previous crash on mount
  useEffect(() => {
    invoke<CrashReport | null>("get_previous_crash").then((crash) => {
      if (crash) setPreviousCrash(crash);
    });
  }, []);

  // Listen for ErrorBoundary "Report problem" events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setBugReportPrefill({
        error: detail?.error,
        context: `Unhandled React error: ${detail?.error}`,
      });
      setShowBugReport(true);
    };
    window.addEventListener("actium:open-bug-report", handler);
    return () => window.removeEventListener("actium:open-bug-report", handler);
  }, []);

  // Show crash recovery screen if there was a previous crash
  if (previousCrash && !crashDismissed) {
    return (
      <CrashRecoveryScreen
        crash={previousCrash}
        onDismiss={() => setCrashDismissed(true)}
        onReport={() => {
          setCrashDismissed(true);
          setBugReportPrefill({
            error: previousCrash.message,
            context: `App crashed at ${previousCrash.location}: ${previousCrash.message}`,
          });
          setShowBugReport(true);
        }}
      />
    );
  }

  return (
    <div className="shell">
      {/* Update prompt — renders as banner or blocking overlay depending on urgency */}
      <UpdatePrompt />

      {/* Titlebar drag region */}
      <div className="titlebar">
        <div className="traffic-lights">
          <div className="traffic-light tl-red" />
          <div className="traffic-light tl-yellow" />
          <div className="traffic-light tl-green" />
        </div>
        <span className="titlebar-text">Actium Tunnel</span>
      </div>

      {/* Sidebar */}
      <div className="sidebar">
        <div className="logo-row">
          <div className="logo-mark">A</div>
          <div className="logo-text">
            <span className="logo-product">Actium</span>
            <span className="logo-sub">TUNNEL v0.1</span>
          </div>
        </div>

        <div className="nav-section">
          <div className="nav-label">Navigation</div>
          <NavItem
            icon={<IconAccounts />}
            label="Accounts"
            active={view === "accounts"}
            onClick={() => setView("accounts")}
          />
          <NavItem
            icon={<IconLog />}
            label="Connections"
            active={view === "log"}
            onClick={() => setView("log")}
          />
          <NavItem
            icon={<IconShield />}
            label="Allowed Domains"
            active={view === "allowlist"}
            onClick={() => setView("allowlist")}
          />
          <NavItem
            icon={<IconInfo />}
            label="About"
            active={view === "about"}
            onClick={() => setView("about")}
          />
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-stat">
            <span>Active tunnels</span>
            <strong
              style={{
                color:
                  connectedCount > 0 ? "var(--green)" : "var(--muted2)",
              }}
            >
              {connectedCount} / {accounts.length}
            </strong>
          </div>
          <div className="sidebar-stat">
            <span>Today</span>
            <strong>{formatBytes(totalBytes)}</strong>
          </div>
          <div className="sidebar-stat relay-stat">
            <span className="mono-small">relay.actium.io</span>
            <span className="relay-status">
              <Dot state="Connected" />
              <span style={{ color: "var(--green)" }}>live</span>
            </span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="main">
        {view === "accounts" && (
          <AccountList
            accounts={accounts}
            onAdd={() => setShowAddModal(true)}
            onRefresh={refresh}
            onReportError={(error) => {
              setBugReportPrefill({
                error,
                context: `Tunnel error: ${error}`,
              });
              setShowBugReport(true);
            }}
          />
        )}
        {view === "log" && <ConnectionLog accounts={accounts} />}
        {view === "allowlist" && <AllowlistViewer />}
        {view === "about" && (
          <AboutScreen onOpenBugReport={() => setShowBugReport(true)} />
        )}
      </div>

      {/* Add Account Modal */}
      {showAddModal && (
        <AddAccountModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            refresh();
          }}
        />
      )}

      {/* Bug Report Modal */}
      {showBugReport && (
        <BugReportModal
          prefill={bugReportPrefill}
          onClose={() => {
            setShowBugReport(false);
            setBugReportPrefill(undefined);
          }}
        />
      )}
    </div>
  );
}

// ── Shared components ──

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>
      {icon} {label}
    </div>
  );
}

export function Dot({ state }: { state: string }) {
  const colors: Record<string, string> = {
    Connected: "#22c55e",
    Connecting: "#f59e0b",
    Disconnected: "#6b7280",
    Error: "#ef4444",
  };
  return (
    <span className="dot-wrap">
      {state === "Connected" && (
        <span
          className="dot-ping"
          style={{ background: colors[state] }}
        />
      )}
      <span
        className="dot"
        style={{ background: colors[state] || "#6b7280" }}
      />
    </span>
  );
}

export function formatBytes(b: number): string {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  if (b >= 1e3) return (b / 1e3).toFixed(0) + " KB";
  return b + " B";
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function connectedDuration(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Icons ──

const SvgIcon = ({
  d,
  size = 16,
}: {
  d: string;
  size?: number;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

export const IconAccounts = () => (
  <SvgIcon d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
);
export const IconLog = () => (
  <SvgIcon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" />
);
export const IconShield = () => (
  <SvgIcon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
);
export const IconPlus = () => <SvgIcon d="M12 5v14M5 12h14" />;
export const IconTrash = () => (
  <SvgIcon d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
);
export const IconCheck = () => <SvgIcon d="M20 6L9 17l-5-5" />;
export const IconGlobe = () => (
  <SvgIcon d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
);
export const IconLink = () => (
  <SvgIcon d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
);
export const IconEye = () => (
  <SvgIcon d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
);
export const IconEyeOff = () => (
  <SvgIcon d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" />
);
export const IconInfo = () => (
  <SvgIcon d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-4M12 8h.01" />
);
