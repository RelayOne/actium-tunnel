import { useState, useCallback } from "react";
import { setBandwidthCap } from "../lib/tauri";

export function useBandwidth() {
  const [updating, setUpdating] = useState(false);

  const updateCap = useCallback(async (accountId: string, capMb: number) => {
    setUpdating(true);
    try {
      await setBandwidthCap(accountId, capMb);
    } catch (e) {
      console.error("Failed to set bandwidth cap:", e);
    } finally {
      setUpdating(false);
    }
  }, []);

  return { updateCap, updating };
}
