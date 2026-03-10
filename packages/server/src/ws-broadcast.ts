import type { WebSocketServer } from "ws";

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
