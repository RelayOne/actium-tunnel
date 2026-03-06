import { useEffect, useState } from "react";
import { Dot, formatBytes, timeAgo } from "../App";
import {
  getConnectionLog,
  type AccountStatus,
  type ConnectionLogEntry,
} from "../lib/tauri";

interface Props {
  accounts: AccountStatus[];
}

export function ConnectionLog({ accounts }: Props) {
  const [filter, setFilter] = useState("all");
  const [entries, setEntries] = useState<ConnectionLogEntry[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const log = await getConnectionLog(
          filter === "all" ? undefined : filter
        );
        setEntries(log);
      } catch (e) {
        console.error("Failed to load connection log:", e);
      }
    };
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [filter]);

  const accountName = (id: string) =>
    accounts.find((a) => a.account_id === id)?.display_name ?? id;

  return (
    <>
      <div className="main-header">
        <div>
          <div className="main-title">Connection Log</div>
          <div className="main-subtitle">
            Last 7 days &middot; {entries.length} connections
          </div>
        </div>
      </div>

      <div className="log-filters">
        <button
          className={`filter-btn ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        {accounts.map((a) => (
          <button
            key={a.account_id}
            className={`filter-btn ${filter === a.account_id ? "active" : ""}`}
            onClick={() => setFilter(a.account_id)}
          >
            {a.display_name}
          </button>
        ))}
      </div>

      <div className="scroll-area" style={{ padding: "6px 20px 16px" }}>
        {entries.length === 0 ? (
          <div
            className="empty-state"
            style={{ height: "auto", padding: "40px 20px" }}
          >
            <p>No connections logged yet.</p>
          </div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="log-row">
              <div className="log-dot">
                <Dot state={entry.blocked ? "Error" : "Connected"} />
              </div>
              <div className="log-host">{entry.host}</div>
              <div className="log-action">{entry.action}</div>
              {filter === "all" && (
                <span className="log-account-tag">
                  {accountName(entry.account_id)}
                </span>
              )}
              <div className="log-bytes">{formatBytes(entry.bytes)}</div>
              <div className="log-time">{timeAgo(entry.timestamp_ms)}</div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
