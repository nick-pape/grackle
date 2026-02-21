import type { EnvironmentAdapter, SidecarConnection } from "./adapters/adapter.js";

const adapters = new Map<string, EnvironmentAdapter>();
const connections = new Map<string, SidecarConnection>();
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

export function registerAdapter(adapter: EnvironmentAdapter): void {
  adapters.set(adapter.type, adapter);
}

export function getAdapter(type: string): EnvironmentAdapter | undefined {
  return adapters.get(type);
}

export function setConnection(envId: string, conn: SidecarConnection): void {
  connections.set(envId, conn);
}

export function getConnection(envId: string): SidecarConnection | undefined {
  return connections.get(envId);
}

export function removeConnection(envId: string): void {
  connections.delete(envId);
}

export function listConnections(): Map<string, SidecarConnection> {
  return connections;
}

export function startHeartbeat(onDisconnect: (envId: string) => void): void {
  if (heartbeatInterval) return;

  heartbeatInterval = setInterval(async () => {
    for (const [envId, conn] of connections) {
      const adapter = adapters.get(conn.envId);
      if (!adapter) continue;

      try {
        const ok = await adapter.healthCheck(conn);
        if (!ok) {
          console.log(`[heartbeat] Health check failed for ${envId}`);
          onDisconnect(envId);
        }
      } catch {
        console.log(`[heartbeat] Connection lost for ${envId}`);
        onDisconnect(envId);
      }
    }
  }, 30_000);
}

export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}
