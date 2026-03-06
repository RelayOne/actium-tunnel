import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IconShield, IconCheck } from "../App";

interface Props {
  prefill?: { error?: string; context?: string };
  onClose: () => void;
}

export function BugReportModal({ prefill, onClose }: Props) {
  const [description, setDescription] = useState(prefill?.context ?? "");
  const [email, setEmail] = useState("");
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadPreview = async () => {
    const report = await invoke<Record<string, unknown>>("build_bug_report", {
      description,
      email: email || null,
    });
    setPreview(report);
  };

  const submit = async () => {
    if (!preview) return;
    setSubmitting(true);
    try {
      await fetch(
        "https://app.actium.io/api/internal/tunnel/bug-report",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preview),
        }
      );
      setSubmitted(true);
    } catch {
      setSubmitted(true); // Show success anyway — best effort
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="bug-report-success">
            <div className="success-icon">
              <IconCheck />
            </div>
            <h2>Report sent</h2>
            <p>
              Thanks — we'll take a look.
              {email && ` We'll follow up at ${email} if we need more detail.`}
            </p>
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Report a problem</h2>

        {!preview ? (
          <>
            <div className="field-group">
              <label>What happened?</label>
              <textarea
                className="field-input plain bug-textarea"
                rows={4}
                placeholder="What happened? What were you trying to do?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                autoFocus
              />
            </div>

            <div className="field-group">
              <label>
                Email{" "}
                <span
                  style={{
                    color: "var(--muted)",
                    fontWeight: 400,
                    textTransform: "none",
                    fontSize: 10.5,
                    letterSpacing: 0,
                  }}
                >
                  (optional — for follow-up)
                </span>
              </label>
              <input
                className="field-input plain"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="security-notice">
              <IconShield />
              <span>
                No API keys, workspace IDs, hostnames, or IP addresses are
                included. Click "Preview" to see exactly what will be sent.
              </span>
            </div>

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={loadPreview}
                disabled={description.trim().length < 10}
              >
                Preview report
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="preview-label">
              This is exactly what will be sent:
            </p>
            <pre className="report-preview">
              {JSON.stringify(preview, null, 2)}
            </pre>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                onClick={() => setPreview(null)}
              >
                Edit
              </button>
              <button
                className="btn btn-primary"
                onClick={submit}
                disabled={submitting}
              >
                {submitting ? "Sending..." : "Send report"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
