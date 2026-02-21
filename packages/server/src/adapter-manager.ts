import type { EnvironmentAdapter, PowerLineConnection } from "./adapters/adapter.js";
import * as envRegistry from "./env-registry.js";
import { logger } from "./logger.js";

const HEARTBEAT_INTERVAL_MS = 30_000;

const adapters = new Map<string, EnvironmentAdapter>();
const connections = new Map<string, PowerLineConnection>();
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

/** Register an environment adapter so it can be looked up by type. */
export function registerAdapter(adapter: EnvironmentAdapter): void {
  adapters.set(adapter.type, adapter);
}

/** Retrieve a registered adapter by its type name. */
export function getAdapter(type: string): EnvironmentAdapter | undefined {
  return adapters.get(type);
}

/** Store an active PowerLine connection for an environment. */
export function setConnection(envId: string, conn: PowerLineConnection): void {
  connections.set(envId, conn);
}

/** Get the active PowerLine connection for an environment, if connected. */
export function getConnection(envId: string): PowerLineConnection | undefined {
  return connections.get(envId);
}

/** Remove the stored connection for an environment. */
export function removeConnection(envId: string): void {
  connections.delete(envId);
}

/** Return the map of all active environment connections. */
export function listConnections(): Map<string, PowerLineConnection> {
  return connections;
}

/** Start a periodic health-check loop that calls `onDisconnect` when a PowerLine becomes unreachable. */
export function startHeartbeat(onDisconnect: (envId: string) => void): void {
  if (heartbeatInterval) {
    return;
  }

  heartbeatInterval = setInterval(async () => {
    for (const [envId, conn] of connections) {
      const env = envRegistry.getEnvironment(envId);
      if (!env) {
        continue;
      }
      const adapter = adapters.get(env.adapterType);
      if (!adapter) {
        continue;
      }

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

/** Stop the periodic health-check loop. */
export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}
