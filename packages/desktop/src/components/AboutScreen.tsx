import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IconCheck } from "../App";

interface UpdateInfo {
  version: string;
  notes: string;
  urgency: string;
  pub_date: string;
}

interface Props {
  onOpenBugReport: () => void;
}

export function AboutScreen({ onOpenBugReport }: Props) {
  const [appVersion, setAppVersion] = useState("");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkedNoUpdate, setCheckedNoUpdate] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    invoke<string>("get_app_version").then(setAppVersion);
  }, []);

  const checkUpdate = async () => {
    setCheckingUpdate(true);
    const info = await invoke<UpdateInfo | null>("check_update");
    setUpdateInfo(info);
    if (!info) setCheckedNoUpdate(true);
    setCheckingUpdate(false);
  };

  return (
    <>
      <div className="main-header">
        <div>
          <div className="main-title">About</div>
          <div className="main-subtitle">App info and diagnostics</div>
        </div>
      </div>

      <div className="scroll-area">
        <div className="about-logo">
          <div className="logo-mark about-logo-mark">A</div>
          <div>
            <div className="about-product-name">Actium Tunnel</div>
            <div className="about-version">v{appVersion}</div>
          </div>
        </div>

        <div className="about-section">
          <div className="about-row">
            <span>Updates</span>
            <div className="about-row-right">
              {!updateInfo && !checkedNoUpdate && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={checkUpdate}
                  disabled={checkingUpdate}
                >
                  {checkingUpdate ? "Checking..." : "Check for updates"}
                </button>
              )}
              {!updateInfo && checkedNoUpdate && (
                <span className="status-ok">
                  <IconCheck /> Up to date
                </span>
              )}
              {updateInfo && (
                <span className="status-update">
                  v{updateInfo.version} available
                </span>
              )}
            </div>
          </div>

          <div className="about-row">
            <span>Relay</span>
            <span className="about-mono">relay.actium.io</span>
          </div>

          <div className="about-row">
            <span>Source code</span>
            <a
              className="about-link"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                invoke("plugin:shell|open", {
                  path: "https://github.com/actium/tunnel",
                });
              }}
            >
              github.com/actium/tunnel
            </a>
          </div>
        </div>

        <div className="about-section">
          <button
            className="btn btn-ghost about-action-btn"
            onClick={onOpenBugReport}
          >
            Report a problem
          </button>
          <button
            className="btn btn-ghost about-action-btn"
            onClick={() =>
              invoke("plugin:shell|open", {
                path: "https://docs.actium.io/tunnel",
              })
            }
          >
            Documentation
          </button>
        </div>
      </div>
    </>
  );
}
