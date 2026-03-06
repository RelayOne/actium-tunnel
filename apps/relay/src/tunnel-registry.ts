import { WebSocket } from "ws";

export interface ActiveTunnel {
  workspaceId: string;
  organizationId: string;
  ws: WebSocket;
  connectedAt: Date;
  bytesRelayed: number;
  tunnelVersion: string;
}

// In-memory registry — could be Redis for multi-instance relay later
const activeTunnels = new Map<string, ActiveTunnel>();

export function registerTunnel(
  workspaceId: string,
  tunnel: ActiveTunnel
): void {
  // One tunnel per workspace — new connection replaces old
  const existing = activeTunnels.get(workspaceId);
  if (existing) {
    console.log(
      `[registry] Replacing existing tunnel for workspace ${workspaceId}`
    );
    existing.ws.close(1000, "Replaced by new connection");
  }
  activeTunnels.set(workspaceId, tunnel);
  console.log(
    `[registry] Registered tunnel for workspace ${workspaceId} (total: ${activeTunnels.size})`
  );
}

export function removeTunnel(workspaceId: string): void {
  activeTunnels.delete(workspaceId);
  console.log(
    `[registry] Removed tunnel for workspace ${workspaceId} (total: ${activeTunnels.size})`
  );
}

export function getTunnel(workspaceId: string): ActiveTunnel | undefined {
  return activeTunnels.get(workspaceId);
}

export function listActiveTunnels(): ActiveTunnel[] {
  return Array.from(activeTunnels.values());
}

export function tunnelCount(): number {
  return activeTunnels.size;
}
