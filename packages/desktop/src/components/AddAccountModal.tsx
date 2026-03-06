import { useState } from "react";
import { IconShield, IconEye, IconEyeOff } from "../App";
import { addAccount } from "../lib/tauri";

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

export function AddAccountModal({ onClose, onSuccess }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<"idle" | "validating" | "error">("idle");
  const [error, setError] = useState("");

  const handleAdd = async () => {
    if (!apiKey.trim()) return;
    setStatus("validating");
    setError("");

    try {
      await addAccount(apiKey.trim(), label.trim() || undefined);
      onSuccess();
    } catch (e) {
      setStatus("error");
      setError(String(e));
    }
  };

  return (
    <div
      className="overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal">
        <h2>Add Account</h2>

        <div className="field-group">
          <label>API Key</label>
          <div className="field-input-wrap">
            <input
              className="field-input"
              type={showKey ? "text" : "password"}
              placeholder="act_live_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              autoFocus
            />
            <button
              className="eye-btn"
              onClick={() => setShowKey((v) => !v)}
              type="button"
            >
              {showKey ? <IconEyeOff /> : <IconEye />}
            </button>
          </div>
          <div className="field-hint">
            Generate in Actium portal &rarr; Settings &rarr; API Keys &rarr;
            enable <em>Tunnel Key</em>
          </div>
        </div>

        <div className="field-group">
          <label>
            Label{" "}
            <span
              style={{
                color: "var(--muted)",
                fontWeight: 400,
                textTransform: "none",
                fontSize: 10.5,
                letterSpacing: 0,
              }}
            >
              (optional)
            </span>
          </label>
          <input
            className="field-input plain"
            type="text"
            placeholder="e.g. Acme Corp - LinkedIn"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        {status === "error" && <div className="error-msg">{error}</div>}

        <div className="security-notice">
          <IconShield />
          <span>
            Your API key is stored in your OS keychain — not in any config file.
            Each key creates one isolated tunnel for its workspace only.
          </span>
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleAdd}
            disabled={status === "validating" || !apiKey.trim()}
          >
            {status === "validating" ? "Validating..." : "Add Account"}
          </button>
        </div>
      </div>
    </div>
  );
}
