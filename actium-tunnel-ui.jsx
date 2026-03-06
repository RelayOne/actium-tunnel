import { useState, useEffect, useRef } from "react";

// ─── Fake data / mock invoke ────────────────────────────────────────────────

const MOCK_ACCOUNTS = [
  {
    id: "acc_1",
    display_name: "Northland Media",
    workspace_name: "LinkedIn Outreach – Q2",
    workspace_id: "ws_abc123",
    state: "Connected",
    connected_at: Date.now() - 1000 * 60 * 47,
    bytes_today: 38_400_000,
    cap_bytes: 500_000_000,
    connections_today: 214,
    last_connection: { host: "www.linkedin.com", time: Date.now() - 4000, bytes: 18_200 },
  },
  {
    id: "acc_2",
    display_name: "Blueridge Agency",
    workspace_name: "TikTok Warmup",
    workspace_id: "ws_def456",
    state: "Connected",
    connected_at: Date.now() - 1000 * 60 * 12,
    bytes_today: 11_200_000,
    cap_bytes: 200_000_000,
    connections_today: 57,
    last_connection: { host: "m.tiktok.com", time: Date.now() - 12000, bytes: 4_100 },
  },
  {
    id: "acc_3",
    display_name: "Pineview Consulting",
    workspace_name: "Instagram DMs",
    workspace_id: "ws_ghi789",
    state: "Error",
    error_message: "API key revoked — regenerate in portal",
    bytes_today: 0,
    cap_bytes: 300_000_000,
    connections_today: 0,
  },
];

const ALLOWED_DOMAINS = [
  "linkedin.com", "www.linkedin.com", "api.linkedin.com",
  "instagram.com", "www.instagram.com", "i.instagram.com",
  "twitter.com", "www.twitter.com", "api.twitter.com",
  "x.com", "www.x.com",
  "tiktok.com", "www.tiktok.com", "m.tiktok.com",
  "google.com", "www.google.com", "maps.googleapis.com", "accounts.google.com",
];

const MOCK_LOG = [
  { id: 1, account_id: "acc_1", host: "www.linkedin.com", action: "Profile view", bytes: 22_400, time: Date.now() - 4_000 },
  { id: 2, account_id: "acc_1", host: "api.linkedin.com", action: "Connection request", bytes: 3_800, time: Date.now() - 18_000 },
  { id: 3, account_id: "acc_2", host: "m.tiktok.com", action: "Feed browse", bytes: 41_200, time: Date.now() - 31_000 },
  { id: 4, account_id: "acc_1", host: "www.linkedin.com", action: "Content like", bytes: 1_200, time: Date.now() - 44_000 },
  { id: 5, account_id: "acc_2", host: "m.tiktok.com", action: "Video watch", bytes: 98_700, time: Date.now() - 67_000 },
  { id: 6, account_id: "acc_1", host: "www.linkedin.com", action: "Search", bytes: 18_900, time: Date.now() - 92_000 },
  { id: 7, account_id: "acc_1", host: "api.linkedin.com", action: "Message sent", bytes: 2_100, time: Date.now() - 130_000 },
  { id: 8, account_id: "acc_2", host: "www.tiktok.com", action: "Profile visit", bytes: 14_300, time: Date.now() - 180_000 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  if (b >= 1e3) return (b / 1e3).toFixed(0) + " KB";
  return b + " B";
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function connectedDuration(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const Icon = ({ d, size = 16, stroke = "currentColor", fill = "none" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}
    stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const IconAccounts   = () => <Icon d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />;
const IconLog        = () => <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" />;
const IconShield     = () => <Icon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />;
const IconPlus       = () => <Icon d="M12 5v14M5 12h14" />;
const IconTrash      = () => <Icon d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />;
const IconCheck      = () => <Icon d="M20 6L9 17l-5-5" />;
const IconX          = () => <Icon d="M18 6L6 18M6 6l12 12" />;
const IconEye        = () => <Icon d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />;
const IconEyeOff     = () => <Icon d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" />;
const IconSignal     = () => <Icon d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16" />;
const IconGlobe      = () => <Icon d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />;
const IconLink       = () => <Icon d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />;

// ─── Dot ─────────────────────────────────────────────────────────────────────

function Dot({ state }) {
  const colors = { Connected: "#22c55e", Connecting: "#f59e0b", Disconnected: "#6b7280", Error: "#ef4444" };
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      {state === "Connected" && (
        <span style={{
          position: "absolute", width: 10, height: 10, borderRadius: "50%",
          background: colors[state], opacity: 0.4,
          animation: "ping 1.5s cubic-bezier(0,0,0.2,1) infinite",
        }} />
      )}
      <span style={{
        width: 8, height: 8, borderRadius: "50%", background: colors[state] || "#6b7280",
        display: "inline-block",
      }} />
    </span>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function ActiumTunnel() {
  const [view, setView] = useState("accounts");
  const [accounts, setAccounts] = useState(MOCK_ACCOUNTS);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [tick, setTick] = useState(0);

  // Tick every 5s to refresh time displays
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const removeAccount = (id) => {
    setAccounts(a => a.filter(x => x.id !== id));
    if (selectedAccount === id) setSelectedAccount(null);
  };

  const addAccount = (newAcc) => {
    setAccounts(a => [...a, newAcc]);
    setShowAdd(false);
  };

  const connectedCount = accounts.filter(a => a.state === "Connected").length;
  const totalBytes = accounts.reduce((s, a) => s + a.bytes_today, 0);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=DM+Sans:wght@300;400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg:       #0e0e10;
          --surface:  #16161a;
          --surface2: #1e1e24;
          --border:   #2a2a32;
          --border2:  #35353f;
          --text:     #e8e8f0;
          --muted:    #6e6e80;
          --muted2:   #9898a8;
          --accent:   #6d5fff;
          --accent2:  #8b7fff;
          --green:    #22c55e;
          --yellow:   #f59e0b;
          --red:      #ef4444;
          --font-sans: 'DM Sans', sans-serif;
          --font-mono: 'IBM Plex Mono', monospace;
          --r:        8px;
        }

        body { background: var(--bg); color: var(--text); font-family: var(--font-sans); }

        @keyframes ping {
          75%, 100% { transform: scale(2); opacity: 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .shell {
          display: flex;
          width: 760px;
          height: 520px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 24px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04) inset;
          font-size: 13px;
          animation: fadeIn 0.3s ease;
        }

        /* ── Titlebar ── */
        .titlebar {
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 36px;
          display: flex;
          align-items: center;
          padding: 0 16px;
          gap: 8px;
          -webkit-app-region: drag;
          z-index: 10;
        }
        .traffic-lights { display: flex; gap: 7px; }
        .traffic-light {
          width: 12px; height: 12px; border-radius: 50%;
          cursor: pointer;
        }
        .tl-red    { background: #ff5f57; }
        .tl-yellow { background: #febc2e; }
        .tl-green  { background: #28c840; }

        /* ── Sidebar ── */
        .sidebar {
          width: 200px;
          min-width: 200px;
          background: var(--surface);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          padding-top: 44px;
        }
        .logo-row {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 0 16px 20px;
        }
        .logo-mark {
          width: 28px; height: 28px;
          background: var(--accent);
          border-radius: 7px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.5px;
          flex-shrink: 0;
          box-shadow: 0 0 18px rgba(109,95,255,0.4);
        }
        .logo-text {
          display: flex; flex-direction: column; gap: 0;
          line-height: 1;
        }
        .logo-product { font-weight: 600; font-size: 13.5px; color: var(--text); letter-spacing: -0.2px; }
        .logo-sub     { font-size: 10px; color: var(--muted); font-family: var(--font-mono); letter-spacing: 0.3px; }

        .nav-section { padding: 0 8px; }
        .nav-label {
          font-size: 10px;
          font-family: var(--font-mono);
          color: var(--muted);
          letter-spacing: 0.8px;
          text-transform: uppercase;
          padding: 6px 8px 4px;
        }
        .nav-item {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 7px 10px;
          border-radius: var(--r);
          cursor: pointer;
          color: var(--muted2);
          font-weight: 400;
          transition: all 0.12s;
          user-select: none;
          font-size: 13px;
          margin-bottom: 1px;
        }
        .nav-item:hover { background: var(--surface2); color: var(--text); }
        .nav-item.active { background: rgba(109,95,255,0.12); color: var(--accent2); font-weight: 500; }
        .nav-item.active svg { stroke: var(--accent2); }

        .sidebar-footer {
          margin-top: auto;
          padding: 12px 16px;
          border-top: 1px solid var(--border);
        }
        .sidebar-stat {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 11.5px;
          color: var(--muted);
          margin-bottom: 4px;
        }
        .sidebar-stat strong { color: var(--text); font-weight: 500; }

        /* ── Main area ── */
        .main {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          padding-top: 36px;
        }
        .main-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px 12px;
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .main-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--text);
          letter-spacing: -0.2px;
        }
        .main-subtitle {
          font-size: 12px;
          color: var(--muted);
          margin-top: 1px;
        }

        /* ── Buttons ── */
        .btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 13px;
          border-radius: 6px;
          font-size: 12.5px;
          font-weight: 500;
          font-family: var(--font-sans);
          cursor: pointer;
          border: none;
          transition: all 0.12s;
          white-space: nowrap;
        }
        .btn-primary {
          background: var(--accent);
          color: #fff;
          box-shadow: 0 0 14px rgba(109,95,255,0.3);
        }
        .btn-primary:hover { background: var(--accent2); box-shadow: 0 0 20px rgba(109,95,255,0.5); }
        .btn-ghost {
          background: transparent;
          color: var(--muted2);
          border: 1px solid var(--border2);
        }
        .btn-ghost:hover { color: var(--text); border-color: var(--border2); background: var(--surface2); }
        .btn-danger {
          background: rgba(239,68,68,0.12);
          color: var(--red);
          border: 1px solid rgba(239,68,68,0.2);
        }
        .btn-danger:hover { background: rgba(239,68,68,0.2); }

        /* ── Scrollable content ── */
        .scroll-area {
          flex: 1;
          overflow-y: auto;
          padding: 12px 20px 16px;
        }
        .scroll-area::-webkit-scrollbar { width: 4px; }
        .scroll-area::-webkit-scrollbar-track { background: transparent; }
        .scroll-area::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 4px; }

        /* ── Account card ── */
        .account-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r);
          margin-bottom: 10px;
          overflow: hidden;
          transition: border-color 0.15s;
          animation: fadeIn 0.2s ease;
        }
        .account-card:hover { border-color: var(--border2); }
        .account-card.selected { border-color: rgba(109,95,255,0.4); }
        .account-card.error { border-color: rgba(239,68,68,0.3); }

        .card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px 10px;
          cursor: pointer;
        }
        .card-left { display: flex; align-items: center; gap: 11px; }
        .card-avatar {
          width: 34px; height: 34px;
          background: var(--surface2);
          border: 1px solid var(--border2);
          border-radius: 7px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 700;
          color: var(--accent2);
          flex-shrink: 0;
          letter-spacing: -0.3px;
        }
        .card-names { display: flex; flex-direction: column; gap: 2px; }
        .card-name { font-weight: 500; font-size: 13px; color: var(--text); }
        .card-workspace { font-size: 11.5px; color: var(--muted); font-family: var(--font-mono); }
        .card-right { display: flex; align-items: center; gap: 8px; }
        .card-state { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--muted2); }

        .error-banner {
          margin: 0 14px 10px;
          padding: 8px 10px;
          background: rgba(239,68,68,0.08);
          border: 1px solid rgba(239,68,68,0.2);
          border-radius: 5px;
          font-size: 11.5px;
          color: var(--red);
          font-family: var(--font-mono);
        }

        .card-stats {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 0;
          border-top: 1px solid var(--border);
          padding: 9px 14px;
        }
        .stat { display: flex; flex-direction: column; gap: 2px; }
        .stat-label { font-size: 10.5px; color: var(--muted); font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.4px; }
        .stat-value { font-size: 13px; font-weight: 500; color: var(--text); }
        .stat-value.mono { font-family: var(--font-mono); }

        .card-bar-row {
          padding: 0 14px 10px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .bar-track {
          flex: 1;
          height: 3px;
          background: var(--surface2);
          border-radius: 2px;
          overflow: hidden;
        }
        .bar-fill {
          height: 100%;
          border-radius: 2px;
          transition: width 0.5s ease;
        }
        .bar-label { font-size: 10.5px; color: var(--muted); font-family: var(--font-mono); white-space: nowrap; }

        .card-actions {
          border-top: 1px solid var(--border);
          padding: 8px 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .card-last-conn {
          font-size: 11px;
          color: var(--muted);
          font-family: var(--font-mono);
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .card-last-conn span { color: var(--muted2); }

        /* ── Empty state ── */
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 12px;
          color: var(--muted);
          padding: 20px;
          text-align: center;
        }
        .empty-icon {
          width: 48px; height: 48px;
          background: var(--surface2);
          border: 1px solid var(--border2);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .empty-state h3 { font-size: 14px; font-weight: 600; color: var(--muted2); }
        .empty-state p { font-size: 12.5px; max-width: 260px; line-height: 1.5; }

        /* ── Modal ── */
        .overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.7);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          animation: fadeIn 0.15s ease;
        }
        .modal {
          background: var(--surface);
          border: 1px solid var(--border2);
          border-radius: 10px;
          width: 380px;
          padding: 20px;
          box-shadow: 0 24px 60px rgba(0,0,0,0.6);
          animation: slideUp 0.2s ease;
        }
        .modal h2 { font-size: 15px; font-weight: 600; margin-bottom: 16px; letter-spacing: -0.2px; }

        .field-group { margin-bottom: 14px; }
        .field-group label {
          display: block;
          font-size: 11.5px;
          font-weight: 500;
          color: var(--muted2);
          margin-bottom: 5px;
          font-family: var(--font-mono);
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        .field-input-wrap { position: relative; }
        .field-input {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--border2);
          border-radius: 6px;
          padding: 8px 36px 8px 11px;
          font-size: 13px;
          font-family: var(--font-mono);
          color: var(--text);
          outline: none;
          transition: border-color 0.15s;
        }
        .field-input:focus { border-color: var(--accent); }
        .field-input.plain { font-family: var(--font-sans); }
        .field-input::placeholder { color: var(--muted); }
        .eye-btn {
          position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer;
          color: var(--muted); padding: 2px;
        }
        .eye-btn:hover { color: var(--muted2); }
        .field-hint {
          font-size: 11px;
          color: var(--muted);
          margin-top: 5px;
          line-height: 1.4;
        }
        .field-hint a { color: var(--accent2); text-decoration: none; }

        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 18px;
          padding-top: 14px;
          border-top: 1px solid var(--border);
        }

        .error-msg {
          background: rgba(239,68,68,0.08);
          border: 1px solid rgba(239,68,68,0.25);
          border-radius: 5px;
          padding: 8px 10px;
          font-size: 12px;
          color: var(--red);
          margin-top: -6px;
          margin-bottom: 10px;
          font-family: var(--font-mono);
        }

        /* ── Log view ── */
        .log-filters {
          display: flex;
          gap: 6px;
          padding: 12px 20px;
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .filter-btn {
          padding: 4px 10px;
          border-radius: 4px;
          font-size: 11.5px;
          font-family: var(--font-mono);
          cursor: pointer;
          border: 1px solid var(--border2);
          background: transparent;
          color: var(--muted2);
          transition: all 0.12s;
        }
        .filter-btn:hover { color: var(--text); border-color: var(--border2); background: var(--surface2); }
        .filter-btn.active { background: rgba(109,95,255,0.12); color: var(--accent2); border-color: rgba(109,95,255,0.3); }

        .log-row {
          display: flex;
          align-items: center;
          padding: 7px 0;
          border-bottom: 1px solid rgba(255,255,255,0.03);
          gap: 12px;
          animation: fadeIn 0.15s ease;
        }
        .log-dot { flex-shrink: 0; }
        .log-host { font-family: var(--font-mono); font-size: 12px; color: var(--muted2); min-width: 160px; }
        .log-action { font-size: 12.5px; color: var(--text); flex: 1; }
        .log-bytes { font-family: var(--font-mono); font-size: 11px; color: var(--muted); min-width: 60px; text-align: right; }
        .log-time { font-family: var(--font-mono); font-size: 11px; color: var(--muted); min-width: 55px; text-align: right; }
        .log-account-tag {
          font-size: 10.5px;
          font-family: var(--font-mono);
          color: var(--muted);
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: 3px;
          padding: 1px 5px;
          white-space: nowrap;
        }

        /* ── Allowlist view ── */
        .trust-banner {
          background: rgba(109,95,255,0.07);
          border: 1px solid rgba(109,95,255,0.2);
          border-radius: var(--r);
          padding: 12px 14px;
          display: flex;
          gap: 11px;
          align-items: flex-start;
          margin-bottom: 14px;
        }
        .trust-banner svg { flex-shrink: 0; margin-top: 1px; stroke: var(--accent2); }
        .trust-banner-text { font-size: 12.5px; color: var(--muted2); line-height: 1.5; }
        .trust-banner-text strong { color: var(--text); display: block; margin-bottom: 3px; font-size: 13px; }
        .trust-banner-text a { color: var(--accent2); text-decoration: none; }
        .trust-banner-text a:hover { text-decoration: underline; }

        .domain-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4px;
        }
        .domain-row {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 6px 10px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 5px;
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--muted2);
        }
        .domain-row svg { stroke: var(--green); flex-shrink: 0; }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", background: "#080810", padding: "20px" }}>

        {/* Titlebar (absolute overlay) */}
        <div style={{ position: "relative", width: 760 }}>
          <div className="titlebar">
            <div className="traffic-lights">
              <div className="traffic-light tl-red" />
              <div className="traffic-light tl-yellow" />
              <div className="traffic-light tl-green" />
            </div>
            <span style={{ position: "absolute", left: "50%", transform: "translateX(-50%)",
              fontSize: 12.5, color: "var(--muted)", fontWeight: 500,
              fontFamily: "var(--font-sans)" }}>
              Actium Tunnel
            </span>
          </div>

          <div className="shell">

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
                {[
                  { id: "accounts", label: "Accounts", Icon: IconAccounts },
                  { id: "log",      label: "Connections", Icon: IconLog },
                  { id: "allowlist",label: "Allowed Domains", Icon: IconShield },
                ].map(({ id, label, Icon: Ic }) => (
                  <div key={id}
                    className={`nav-item ${view === id ? "active" : ""}`}
                    onClick={() => setView(id)}>
                    <Ic /> {label}
                  </div>
                ))}
              </div>

              <div className="sidebar-footer">
                <div className="sidebar-stat">
                  <span>Active tunnels</span>
                  <strong style={{ color: connectedCount > 0 ? "var(--green)" : "var(--muted2)" }}>
                    {connectedCount} / {accounts.length}
                  </strong>
                </div>
                <div className="sidebar-stat">
                  <span>Today</span>
                  <strong>{formatBytes(totalBytes)}</strong>
                </div>
                <div className="sidebar-stat" style={{ marginBottom: 0, marginTop: 6, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 10.5, fontFamily: "var(--font-mono)" }}>relay.actium.io</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Dot state="Connected" />
                    <span style={{ fontSize: 10.5, color: "var(--green)" }}>live</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Main */}
            <div className="main">
              {view === "accounts" && (
                <AccountsView
                  accounts={accounts}
                  onAdd={() => setShowAdd(true)}
                  onRemove={removeAccount}
                  selectedAccount={selectedAccount}
                  onSelect={setSelectedAccount}
                />
              )}
              {view === "log" && <LogView accounts={accounts} />}
              {view === "allowlist" && <AllowlistView />}
            </div>
          </div>
        </div>

        {/* Add Account Modal */}
        {showAdd && (
          <AddModal onClose={() => setShowAdd(false)} onAdd={addAccount} />
        )}
      </div>
    </>
  );
}

// ─── Accounts View ────────────────────────────────────────────────────────────

function AccountsView({ accounts, onAdd, onRemove, selectedAccount, onSelect }) {
  const totalToday = accounts.reduce((s, a) => s + a.bytes_today, 0);

  return (
    <>
      <div className="main-header">
        <div>
          <div className="main-title">Accounts</div>
          <div className="main-subtitle">
            {accounts.length} account{accounts.length !== 1 ? "s" : ""} · {formatBytes(totalToday)} used today
          </div>
        </div>
        <button className="btn btn-primary" onClick={onAdd}>
          <IconPlus /> Add Account
        </button>
      </div>

      <div className="scroll-area">
        {accounts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><IconLink size={20} /></div>
            <h3>No accounts yet</h3>
            <p>Add an Actium API key to start routing agent traffic through your own IP address.</p>
            <button className="btn btn-primary" onClick={onAdd}>
              <IconPlus /> Add Account
            </button>
          </div>
        ) : (
          accounts.map(account => (
            <AccountCard
              key={account.id}
              account={account}
              selected={selectedAccount === account.id}
              onSelect={() => onSelect(selectedAccount === account.id ? null : account.id)}
              onRemove={() => onRemove(account.id)}
            />
          ))
        )}
      </div>
    </>
  );
}

function AccountCard({ account, selected, onSelect, onRemove }) {
  const pct = account.cap_bytes > 0 ? Math.min((account.bytes_today / account.cap_bytes) * 100, 100) : 0;
  const initials = account.display_name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

  const barColor = pct > 90 ? "var(--red)" : pct > 70 ? "var(--yellow)" : "var(--accent)";

  return (
    <div className={`account-card ${selected ? "selected" : ""} ${account.state === "Error" ? "error" : ""}`}>
      <div className="card-top" onClick={onSelect}>
        <div className="card-left">
          <div className="card-avatar">{initials}</div>
          <div className="card-names">
            <div className="card-name">{account.display_name}</div>
            <div className="card-workspace">{account.workspace_name}</div>
          </div>
        </div>
        <div className="card-right">
          <div className="card-state">
            <Dot state={account.state} />
            <span style={{
              color: account.state === "Connected" ? "var(--green)"
                   : account.state === "Error"     ? "var(--red)"
                   : "var(--muted2)"
            }}>
              {account.state}
            </span>
            {account.state === "Connected" && (
              <span style={{ color: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                {connectedDuration(account.connected_at)}
              </span>
            )}
          </div>
        </div>
      </div>

      {account.state === "Error" && (
        <div className="error-banner">{account.error_message}</div>
      )}

      {account.state !== "Error" && (
        <>
          <div className="card-stats">
            <div className="stat">
              <div className="stat-label">Used today</div>
              <div className="stat-value mono">{formatBytes(account.bytes_today)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Cap</div>
              <div className="stat-value mono">{formatBytes(account.cap_bytes)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Connections</div>
              <div className="stat-value">{account.connections_today}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Usage</div>
              <div className="stat-value" style={{ color: pct > 90 ? "var(--red)" : "var(--text)" }}>
                {pct.toFixed(0)}%
              </div>
            </div>
          </div>

          <div className="card-bar-row">
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${pct}%`, background: barColor }} />
            </div>
            <span className="bar-label">
              {formatBytes(account.cap_bytes - account.bytes_today)} remaining
            </span>
          </div>
        </>
      )}

      <div className="card-actions">
        {account.last_connection ? (
          <div className="card-last-conn">
            <IconGlobe size={11} />
            <span>{account.last_connection.host}</span>
            &nbsp;·&nbsp;{timeAgo(account.last_connection.time)}
          </div>
        ) : (
          <div className="card-last-conn">No connections yet</div>
        )}
        <button className="btn btn-danger" style={{ padding: "4px 9px", fontSize: 11.5 }}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <IconTrash size={12} /> Remove
        </button>
      </div>
    </div>
  );
}

// ─── Log View ─────────────────────────────────────────────────────────────────

function LogView({ accounts }) {
  const [filter, setFilter] = useState("all");

  const filtered = filter === "all"
    ? MOCK_LOG
    : MOCK_LOG.filter(e => e.account_id === filter);

  const accountName = (id) => accounts.find(a => a.id === id)?.display_name ?? id;

  return (
    <>
      <div className="main-header">
        <div>
          <div className="main-title">Connection Log</div>
          <div className="main-subtitle">Last 7 days · {MOCK_LOG.length} connections</div>
        </div>
      </div>

      <div className="log-filters">
        <button className={`filter-btn ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}>All</button>
        {accounts.map(a => (
          <button key={a.id}
            className={`filter-btn ${filter === a.id ? "active" : ""}`}
            onClick={() => setFilter(a.id)}>
            {a.display_name}
          </button>
        ))}
      </div>

      <div className="scroll-area" style={{ padding: "6px 20px 16px" }}>
        {filtered.map(entry => (
          <div key={entry.id} className="log-row">
            <div className="log-dot"><Dot state="Connected" /></div>
            <div className="log-host">{entry.host}</div>
            <div className="log-action">{entry.action}</div>
            {filter === "all" && (
              <span className="log-account-tag">{accountName(entry.account_id)}</span>
            )}
            <div className="log-bytes">{formatBytes(entry.bytes)}</div>
            <div className="log-time">{timeAgo(entry.time)}</div>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Allowlist View ───────────────────────────────────────────────────────────

function AllowlistView() {
  return (
    <>
      <div className="main-header">
        <div>
          <div className="main-title">Allowed Domains</div>
          <div className="main-subtitle">Traffic is only forwarded to these hosts</div>
        </div>
      </div>

      <div className="scroll-area">
        <div className="trust-banner">
          <IconShield size={18} />
          <div className="trust-banner-text">
            <strong>This list is compiled into the app binary.</strong>
            The relay server cannot modify it, add hosts, or instruct the app to connect to
            arbitrary destinations. Changing this list requires recompiling from source.&nbsp;
            <a href="https://github.com/actium/tunnel" target="_blank" rel="noopener noreferrer">
              View source →
            </a>
          </div>
        </div>

        <div className="domain-grid">
          {ALLOWED_DOMAINS.map(d => (
            <div key={d} className="domain-row">
              <IconCheck size={12} />
              {d}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Add Account Modal ────────────────────────────────────────────────────────

function AddModal({ onClose, onAdd }) {
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel]   = useState("");
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | validating | error
  const [error, setError]   = useState("");

  const validate = async () => {
    if (!apiKey.trim()) return;
    setStatus("validating");
    setError("");

    // Simulate API key validation
    await new Promise(r => setTimeout(r, 900));

    if (!apiKey.startsWith("act_")) {
      setStatus("error");
      setError("Invalid API key format. Keys start with act_live_ or act_test_");
      return;
    }

    // Mock success
    const newAccount = {
      id: `acc_${Date.now()}`,
      display_name: label.trim() || "New Account",
      workspace_name: "Default Workspace",
      workspace_id: `ws_${Math.random().toString(36).slice(2,8)}`,
      state: "Connecting",
      bytes_today: 0,
      cap_bytes: 500_000_000,
      connections_today: 0,
    };
    onAdd(newAccount);
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Add Account</h2>

        <div className="field-group">
          <label>API Key</label>
          <div className="field-input-wrap">
            <input
              className="field-input"
              type={showKey ? "text" : "password"}
              placeholder="act_live_…"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              onKeyDown={e => e.key === "Enter" && validate()}
              autoFocus
            />
            <button className="eye-btn" onClick={() => setShowKey(v => !v)} type="button">
              {showKey ? <IconEyeOff size={14} /> : <IconEye size={14} />}
            </button>
          </div>
          <div className="field-hint">
            Generate in Actium portal → Settings → API Keys → enable <em>Tunnel Key</em>
          </div>
        </div>

        <div className="field-group">
          <label>Label <span style={{ color: "var(--muted)", fontWeight: 400, textTransform: "none",
            fontSize: 10.5, letterSpacing: 0 }}>(optional)</span></label>
          <input
            className="field-input plain"
            type="text"
            placeholder="e.g. Acme Corp – LinkedIn"
            value={label}
            onChange={e => setLabel(e.target.value)}
          />
        </div>

        {status === "error" && <div className="error-msg">{error}</div>}

        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)",
          borderRadius: 6, padding: "9px 11px", marginBottom: 4 }}>
          <div style={{ fontSize: 11.5, color: "var(--muted2)", display: "flex",
            alignItems: "flex-start", gap: 8 }}>
            <IconShield size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ lineHeight: 1.5 }}>
              Your API key is stored in your OS keychain — not in any config file.
              Each key creates one isolated tunnel for its workspace only.
            </span>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={validate}
            disabled={status === "validating" || !apiKey.trim()}
            style={{ opacity: (!apiKey.trim() || status === "validating") ? 0.6 : 1 }}>
            {status === "validating" ? "Validating…" : "Add Account"}
          </button>
        </div>
      </div>
    </div>
  );
}
