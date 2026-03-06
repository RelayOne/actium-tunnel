import { listActiveTunnels } from "./tunnel-registry.js";

/**
 * Periodically reports bandwidth usage back to the Actium portal.
 * This allows the portal to display tunnel usage in the dashboard.
 */
export function startBandwidthReporter(intervalMs = 60_000): NodeJS.Timeout {
  return setInterval(async () => {
    const tunnels = listActiveTunnels();
    if (tunnels.length === 0) return;

    const reports = tunnels.map((t) => ({
      workspaceId: t.workspaceId,
      organizationId: t.organizationId,
      bytesRelayed: t.bytesRelayed,
      connectedSince: t.connectedAt.toISOString(),
    }));

    try {
      const portalUrl =
        process.env.PORTAL_API_URL ?? "http://localhost:3000/api";
      const secret = process.env.INTERNAL_SECRET ?? "";

      await fetch(`${portalUrl}/internal/tunnel/bandwidth-report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": secret,
        },
        body: JSON.stringify({ reports }),
      });

      console.log(
        `[bandwidth] Reported usage for ${reports.length} tunnel(s)`
      );
    } catch (err) {
      console.error("[bandwidth] Failed to report usage:", err);
    }
  }, intervalMs);
}
