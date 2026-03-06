import { WebSocket } from "ws";
import { getTunnel } from "./tunnel-registry.js";

let sessionCounter = 0;

/**
 * Encodes a proxy request into the binary format expected by the desktop tunnel.
 * Format: [4-byte session-id][2-byte target-port][target-host-null-terminated][payload]
 */
function encodeSessionHeader(
  sessionId: number,
  targetHost: string,
  targetPort: number
): Buffer {
  const sessionBuf = Buffer.alloc(4);
  sessionBuf.writeUInt32BE(sessionId);

  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(targetPort);

  const hostBuf = Buffer.from(targetHost + "\0", "utf8");

  return Buffer.concat([sessionBuf, portBuf, hostBuf]);
}

/**
 * Routes a proxy request through the appropriate desktop tunnel.
 * Called by the worker's browser session when it needs to route through a client's tunnel.
 */
export async function routeThroughTunnel(
  workspaceId: string,
  targetHost: string,
  targetPort: number,
  payload: Buffer
): Promise<Buffer> {
  const tunnel = getTunnel(workspaceId);
  if (!tunnel) {
    throw new Error(`No active tunnel for workspace ${workspaceId}`);
  }

  if (tunnel.ws.readyState !== WebSocket.OPEN) {
    throw new Error(`Tunnel for workspace ${workspaceId} is not connected`);
  }

  const sessionId = ++sessionCounter & 0xffffffff; // wrap at 32-bit

  return new Promise<Buffer>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Tunnel response timeout for workspace ${workspaceId}`));
    }, 30000); // 30s timeout

    const onMessage = (data: Buffer) => {
      // Check if this response matches our session ID
      if (data.length < 5) return;
      const respSessionId = data.readUInt32BE(0);
      if (respSessionId !== sessionId) return;

      cleanup();

      const statusByte = data[4];
      if (statusByte !== 0x00) {
        const errorCodes: Record<number, string> = {
          0x01: "Host blocked by allowlist",
          0x02: "Bandwidth cap reached",
          0x03: "Connection to target failed",
        };
        reject(
          new Error(
            errorCodes[statusByte] ?? `Tunnel error code: ${statusByte}`
          )
        );
        return;
      }

      // Success — return the response payload (everything after session ID + status byte)
      const responsePayload = data.subarray(5);
      tunnel.bytesRelayed += payload.length + responsePayload.length;
      resolve(Buffer.from(responsePayload));
    };

    const onClose = () => {
      cleanup();
      reject(new Error(`Tunnel disconnected for workspace ${workspaceId}`));
    };

    const onError = (err: Error) => {
      cleanup();
      reject(
        new Error(
          `Tunnel error for workspace ${workspaceId}: ${err.message}`
        )
      );
    };

    const cleanup = () => {
      clearTimeout(timeout);
      tunnel.ws.off("message", onMessage);
      tunnel.ws.off("close", onClose);
      tunnel.ws.off("error", onError);
    };

    tunnel.ws.on("message", onMessage);
    tunnel.ws.on("close", onClose);
    tunnel.ws.on("error", onError);

    // Send the request to the tunnel
    const header = encodeSessionHeader(sessionId, targetHost, targetPort);
    tunnel.ws.send(Buffer.concat([header, payload]));
  });
}
