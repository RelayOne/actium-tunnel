import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { IconShield } from "../App";

interface UpdateInfo {
  version: string;
  notes: string;
  urgency: "security" | "required" | "recommended" | "optional";
  pub_date: string;
}

export function UpdatePrompt() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [readyToInstall, setReadyToInstall] = useState(false);

  useEffect(() => {
    // Check on mount
    invoke<UpdateInfo | null>("check_update").then((u) => {
      if (u) setUpdate(u);
    });

    // Listen for update available events from background checker
    const unlistenAvailable = listen<UpdateInfo>("update:available", (e) => {
      setUpdate(e.payload);
    });

    // Listen for relay version rejection
    const unlistenRejected = listen("tunnel:version_rejected", () => {
      invoke<UpdateInfo | null>("check_update").then((u) => {
        if (u) setUpdate(u);
      });
    });

    // Listen for download completion
    const unlistenReady = listen("update:ready_to_install", () => {
      setReadyToInstall(true);
      setDownloading(false);
    });

    return () => {
      unlistenAvailable.then((f) => f());
      unlistenRejected.then((f) => f());
      unlistenReady.then((f) => f());
    };
  }, []);

  if (!update) return null;

  // "optional" updates don't get a proactive prompt
  if (update.urgency === "optional") return null;

  const isBlocking =
    update.urgency === "security" || update.urgency === "required";

  const handleDownload = () => {
    setDownloading(true);
    invoke("install_update").catch(() => setDownloading(false));
  };

  return (
    <div
      className={`update-prompt urgency-${update.urgency}`}
      style={isBlocking ? { position: "fixed", inset: 0, zIndex: 200 } : {}}
    >
      <div
        className="update-prompt-inner"
        style={isBlocking ? {} : { borderRadius: 0 }}
      >
        <div className="update-header">
          {update.urgency === "security" && (
            <IconUpdateShield className="icon-red" />
          )}
          {update.urgency === "required" && (
            <IconAlertCircle className="icon-yellow" />
          )}
          {update.urgency === "recommended" && (
            <IconRefresh className="icon-accent" />
          )}
          <strong>
            {update.urgency === "security" && "Security update required"}
            {update.urgency === "required" && "Update required"}
            {update.urgency === "recommended" &&
              `Update available — v${update.version}`}
          </strong>
        </div>

        <p className="update-notes">{update.notes}</p>

        {update.urgency === "security" && (
          <div className="security-notice" style={{ margin: "10px 0" }}>
            <IconShield />
            <span>
              A security vulnerability was found in your current version. Update
              immediately to keep your tunnels secure.
            </span>
          </div>
        )}

        <div className="update-actions">
          {!readyToInstall ? (
            <button
              className="btn btn-primary"
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading
                ? "Downloading..."
                : `Update to v${update.version}`}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => invoke("restart_app")}
            >
              Restart to apply
            </button>
          )}
          {!isBlocking && !readyToInstall && (
            <button
              className="btn btn-ghost"
              onClick={() => setUpdate(null)}
            >
              Later
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Local icon components
function IconUpdateShield({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function IconAlertCircle({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function IconRefresh({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}
