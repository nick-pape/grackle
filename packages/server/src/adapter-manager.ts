import type { EnvironmentAdapter, PowerLineConnection } from "./adapters/adapter.js";
import * as envRegistry from "./env-registry.js";
import { logger } from "./logger.js";

const HEARTBEAT_INTERVAL_MS: number = 30_000;

const adapters: Map<string, EnvironmentAdapter> = new Map<string, EnvironmentAdapter>();
const connections: Map<string, PowerLineConnection> = new Map<string, PowerLineConnection>();
let heartbeatInterval: ReturnType<typeof setInterval> | undefined = undefined;

/** Register an environment adapter so it can be looked up by type. */
export function registerAdapter(adapter: EnvironmentAdapter): void {
  adapters.set(adapter.type, adapter);
}

/** Retrieve a registered adapter by its type name. */
export function getAdapter(type: string): EnvironmentAdapter | undefined {
  return adapters.get(type);
}

/** Store an active PowerLine connection for an environment. */
export function setConnection(environmentId: string, conn: PowerLineConnection): void {
  connections.set(environmentId, conn);
}

/** Get the active PowerLine connection for an environment, if connected. */
export function getConnection(environmentId: string): PowerLineConnection | undefined {
  return connections.get(environmentId);
}

/** Remove the stored connection for an environment. */
export function removeConnection(environmentId: string): void {
  connections.delete(environmentId);
}

/** Return the map of all active environment connections. */
export function listConnections(): Map<string, PowerLineConnection> {
  return connections;
}

/** Start a periodic health-check loop that calls `onDisconnect` when a PowerLine becomes unreachable. */
export function startHeartbeat(onDisconnect: (environmentId: string) => void): void {
  if (heartbeatInterval !== undefined) {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  heartbeatInterval = setInterval(async () => {
    for (const [environmentId, conn] of connections) {
      const env = envRegistry.getEnvironment(environmentId);
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
          logger.warn({ environmentId }, "Health check failed");
          onDisconnect(environmentId);
        }
      } catch {
        logger.warn({ environmentId }, "Connection lost");
        onDisconnect(environmentId);
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

/** Stop the periodic health-check loop. */
export function stopHeartbeat(): void {
  if (heartbeatInterval !== undefined) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = undefined;
  }
}
