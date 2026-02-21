import type { EnvironmentAdapter, SidecarConnection } from "./adapters/adapter.js";
import * as envRegistry from "./env-registry.js";
import { logger } from "./logger.js";

const HEARTBEAT_INTERVAL_MS = 30_000;

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
      const env = envRegistry.getEnvironment(envId);
      if (!env) continue;
      const adapter = adapters.get(env.adapter_type);
      if (!adapter) continue;

      try {
        const ok = await adapter.healthCheck(conn);
        if (!ok) {
          logger.warn({ envId }, "Health check failed");
          onDisconnect(envId);
        }
      } catch {
        logger.warn({ envId }, "Connection lost");
        onDisconnect(envId);
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}
