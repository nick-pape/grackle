import type { WebSocketServer } from "ws";
import { envRegistry } from "@grackle-ai/database";
import { subscribe, type GrackleEvent } from "./event-bus.js";

let wssInstance: WebSocketServer | undefined = undefined;

/** Set the WebSocketServer instance used for broadcasting. Called once during server startup. */
export function setWssInstance(wss: WebSocketServer): void {
  wssInstance = wss;
}

/** Broadcast a message to all connected WS clients. */
export function broadcast(msg: { type: string; payload?: Record<string, unknown> }): void {
  if (!wssInstance) return;
  const data = JSON.stringify(msg);
  for (const client of wssInstance.clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(data);
    }
  }
}

/** Map a database environment row to the WebSocket payload shape. */
export function envRowToWs(
  r: ReturnType<typeof envRegistry.listEnvironments>[number],
): Record<string, unknown> {
  return {
    id: r.id,
    displayName: r.displayName,
    adapterType: r.adapterType,
    adapterConfig: r.adapterConfig,
    status: r.status,
    bootstrapped: r.bootstrapped,
  };
}

/** Broadcast the current environment list to all connected WebSocket clients. */
export function broadcastEnvironments(): void {
  broadcast({
    type: "environments",
    payload: { environments: envRegistry.listEnvironments().map(envRowToWs) },
  });
}

/** Guard to ensure initWsSubscriber is only called once. */
let wsSubscriberInitialized: boolean = false;

/**
 * Register a bus subscriber that forwards GrackleEvents to all WS clients.
 * Idempotent — subsequent calls are no-ops.
 */
export function initWsSubscriber(): void {
  if (wsSubscriberInitialized) {
    return;
  }
  wsSubscriberInitialized = true;
  subscribe((event: GrackleEvent) => {
    if (!wssInstance) {
      return;
    }
    const data = JSON.stringify(event);
    for (const client of wssInstance.clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(data);
      }
    }
  });
}
