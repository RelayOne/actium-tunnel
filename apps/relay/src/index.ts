import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { validateApiKey } from "./auth-middleware.js";
import {
  registerTunnel,
  removeTunnel,
  tunnelCount,
} from "./tunnel-registry.js";
import { startBandwidthReporter } from "./bandwidth-reporter.js";

const PORT = parseInt(process.env.PORT ?? "8443", 10);
const MIN_TUNNEL_VERSION = process.env.MIN_TUNNEL_VERSION ?? "0.1.0";

const wss = new WebSocketServer({ port: PORT });
console.log(`[relay] Actium Tunnel Relay listening on port ${PORT}`);

// Ping all connected tunnels every 30s to detect stale connections
const aliveMap = new WeakMap<WebSocket, boolean>();

const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!aliveMap.get(ws)) {
      ws.terminate();
      return;
    }
    aliveMap.set(ws, false);
    ws.ping();
  });
}, 30_000);

wss.on("close", () => clearInterval(pingInterval));

// Start bandwidth reporting
startBandwidthReporter();

wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
  const apiKey = req.headers["x-actium-api-key"] as string;
  const workspaceId = req.headers["x-actium-workspace-id"] as string;
  const tunnelVersion = req.headers["x-tunnel-version"] as string;

  console.log(
    `[relay] New connection from workspace=${workspaceId ?? "unknown"} version=${tunnelVersion ?? "unknown"}`
  );

  if (!apiKey || !workspaceId) {
    ws.close(4001, "Missing authentication headers");
    return;
  }

  // Validate API key against Actium portal
  const auth = await validateApiKey(apiKey, workspaceId);
  if (!auth.valid) {
    console.log(
      `[relay] Auth failed for workspace ${workspaceId}: ${auth.reason}`
    );
    ws.close(4003, auth.reason ?? "Invalid API key");
    return;
  }

  // Check minimum tunnel version
  if (!isTunnelVersionAccepted(tunnelVersion)) {
    console.log(
      `[relay] Tunnel version ${tunnelVersion} rejected (minimum: ${MIN_TUNNEL_VERSION})`
    );
    ws.close(4009, "Tunnel version too old. Please update Actium Tunnel.");
    return;
  }

  // Set up keep-alive tracking
  aliveMap.set(ws, true);
  ws.on("pong", () => {
    aliveMap.set(ws, true);
  });

  // Register the tunnel
  registerTunnel(workspaceId, {
    workspaceId,
    organizationId: auth.organizationId,
    ws,
    connectedAt: new Date(),
    bytesRelayed: 0,
    tunnelVersion: tunnelVersion ?? "unknown",
  });

  console.log(
    `[relay] Tunnel registered for workspace ${workspaceId} (active: ${tunnelCount()})`
  );

  ws.on("close", () => {
    removeTunnel(workspaceId);
    console.log(
      `[relay] Tunnel closed for workspace ${workspaceId} (active: ${tunnelCount()})`
    );
  });

  ws.on("error", (err) => {
    console.error(
      `[relay] WebSocket error for workspace ${workspaceId}:`,
      err.message
    );
    removeTunnel(workspaceId);
  });
});

function isTunnelVersionAccepted(version: string | undefined): boolean {
  if (!version) return false;

  const minParts = MIN_TUNNEL_VERSION.split(".").map(Number);
  const verParts = version.split(".").map(Number);

  for (let i = 0; i < minParts.length; i++) {
    const min = minParts[i] ?? 0;
    const ver = verParts[i] ?? 0;
    if (ver > min) return true;
    if (ver < min) return false;
  }
  return true; // equal
}

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[relay] Shutting down...");
  wss.close(() => {
    console.log("[relay] Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("[relay] Shutting down...");
  wss.close(() => {
    console.log("[relay] Server closed");
    process.exit(0);
  });
});

// Export for use by worker processes
export { routeThroughTunnel } from "./session-router.js";
export { getTunnel, listActiveTunnels } from "./tunnel-registry.js";
