import { useState } from "react";
import {
  Dot,
  formatBytes,
  connectedDuration,
  IconPlus,
  IconTrash,
  IconGlobe,
  IconLink,
} from "../App";
import { removeAccount as removeAccountApi, type AccountStatus } from "../lib/tauri";

interface Props {
  accounts: AccountStatus[];
  onAdd: () => void;
  onRefresh: () => void;
  onReportError?: (error: string) => void;
}

export function AccountList({ accounts, onAdd, onRefresh, onReportError }: Props) {
  const totalToday = accounts.reduce((s, a) => s + a.bytes_today, 0);

  return (
    <>
      <div className="main-header">
        <div>
          <div className="main-title">Accounts</div>
          <div className="main-subtitle">
            {accounts.length} account{accounts.length !== 1 ? "s" : ""} &middot;{" "}
            {formatBytes(totalToday)} used today
          </div>
        </div>
        <button className="btn btn-primary" onClick={onAdd}>
          <IconPlus /> Add Account
        </button>
      </div>

      <div className="scroll-area">
        {accounts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <IconLink />
            </div>
            <h3>No accounts yet</h3>
            <p>
              Add an Actium API key to start routing agent traffic through your
              own IP address.
            </p>
            <button className="btn btn-primary" onClick={onAdd}>
              <IconPlus /> Add Account
            </button>
          </div>
        ) : (
          accounts.map((account) => (
            <AccountCard
              key={account.account_id}
              account={account}
              onRemove={() => handleRemove(account.account_id, onRefresh)}
              onReportError={onReportError}
            />
          ))
        )}
      </div>
    </>
  );
}

async function handleRemove(accountId: string, onRefresh: () => void) {
  if (!confirm("Remove this account? The tunnel will disconnect immediately.")) {
    return;
  }
  try {
    await removeAccountApi(accountId);
    onRefresh();
  } catch (e) {
    console.error("Failed to remove account:", e);
  }
}

function AccountCard({
  account,
  onRemove,
  onReportError,
}: {
  account: AccountStatus;
  onRemove: () => void;
  onReportError?: (error: string) => void;
}) {
  const pct =
    account.cap_bytes > 0
      ? Math.min((account.bytes_today / account.cap_bytes) * 100, 100)
      : 0;

  const initials = account.display_name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const barColor =
    pct > 90 ? "var(--red)" : pct > 70 ? "var(--yellow)" : "var(--accent)";

  const stateColor =
    account.state === "Connected"
      ? "var(--green)"
      : account.state === "Error"
        ? "var(--red)"
        : "var(--muted2)";

  return (
    <div
      className={`account-card ${account.state === "Error" ? "error" : ""}`}
    >
      <div className="card-top">
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
            <span style={{ color: stateColor }}>{account.state}</span>
            {account.state === "Connected" && account.connected_at_ms && (
              <span
                style={{
                  color: "var(--muted)",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                }}
              >
                {connectedDuration(account.connected_at_ms)}
              </span>
            )}
          </div>
        </div>
      </div>

      {account.state === "Error" && account.error_message && (
        <div className="error-banner">
          {account.error_message}
          {onReportError && (
            <a
              className="error-report-link"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onReportError(account.error_message!);
              }}
            >
              Report this error
            </a>
          )}
        </div>
      )}

      {account.state !== "Error" && (
        <>
          <div className="card-stats">
            <div className="stat">
              <div className="stat-label">Used today</div>
              <div className="stat-value mono">
                {formatBytes(account.bytes_today)}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Cap</div>
              <div className="stat-value mono">
                {formatBytes(account.cap_bytes)}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Connections</div>
              <div className="stat-value">{account.connections_today}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Usage</div>
              <div
                className="stat-value"
                style={{ color: pct > 90 ? "var(--red)" : "var(--text)" }}
              >
                {pct.toFixed(0)}%
              </div>
            </div>
          </div>

          <div className="card-bar-row">
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${pct}%`, background: barColor }}
              />
            </div>
            <span className="bar-label">
              {formatBytes(
                Math.max(0, account.cap_bytes - account.bytes_today)
              )}{" "}
              remaining
            </span>
          </div>
        </>
      )}

      <div className="card-actions">
        <div className="card-last-conn">
          <IconGlobe />
          <span>{account.workspace_id}</span>
        </div>
        <button
          className="btn btn-danger"
          style={{ padding: "4px 9px", fontSize: 11.5 }}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <IconTrash /> Remove
        </button>
      </div>
    </div>
  );
}
