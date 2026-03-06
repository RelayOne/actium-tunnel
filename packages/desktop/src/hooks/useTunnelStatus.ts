import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { getStatus, type AccountStatus } from "../lib/tauri";

export function useTunnelStatus() {
  const [accounts, setAccounts] = useState<AccountStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const statuses = await getStatus();
      setAccounts(statuses);
    } catch (e) {
      console.error("Failed to get status:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    // Live updates from tunnel state changes
    const unlisten = listen<AccountStatus[]>("tunnel:status_update", (e) => {
      setAccounts(e.payload);
    });

    // Poll every 5s for bandwidth updates
    const interval = setInterval(refresh, 5000);

    return () => {
      unlisten.then((f) => f());
      clearInterval(interval);
    };
  }, [refresh]);

  return { accounts, loading, refresh };
}
