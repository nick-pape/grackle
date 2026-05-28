import { AhpClientSocket, InMemoryClientIdStore } from "@grackle-ai/ahp-transport";
import { createConnection } from "node:net";
import type { PowerLineConnection } from "./adapter.js";
import { AhpHostTransport } from "./ahp-host-transport.js";
import { closeTunnel } from "./tunnel-registry.js";
import { sleep } from "./utils.js";
import type { AdapterLogger } from "./logger.js";
import { defaultLogger } from "./logger.js";

// ─── Constants ──────────────────────────────────────────────

/** Delay between connect-with-retry attempts. */
const CONNECT_RETRY_DELAY_MS: number = 1_500;

/** Maximum number of connect-with-retry attempts. */
const CONNECT_MAX_RETRIES: number = 10;

/** Delay between port availability polls. */
const TUNNEL_PORT_POLL_DELAY_MS: number = 500;

/** Maximum number of port availability polls. */
const TUNNEL_PORT_POLL_MAX_ATTEMPTS: number = 20;

// ─── AHP Host Transport Helper ──────────────────────────────

/**
 * Construct an opened {@link AhpHostTransport} for a single PowerLine.
 *
 * Opens an `AhpClientSocket` to `${baseUrl}/ahp`, awaits the AHP
 * `initialize` handshake, and returns the transport ready for use.
 *
 * `InMemoryClientIdStore` is used by default — Grackle's adapter
 * connections are ephemeral (one per provision; reconnect creates a fresh
 * one). Persistent `clientId` across server restarts is not required for
 * HR8d. A future optimization (HR8a-followup #1344) would persist for
 * reconnect-RPC replay efficiency.
 *
 * @param baseUrl - Origin URL of the PowerLine (e.g. `ws://127.0.0.1:7433`).
 *   The helper appends `/ahp` to form the WebSocket URL.
 * @param powerlineToken - Bearer token sent on the HTTP upgrade.
 * @param environmentId - Used as the `clientIdKey` to namespace the
 *   persisted clientId within the store.
 * @param logger - Optional logger for state transitions.
 * @returns The opened transport.
 */
export async function createAhpHostTransport(
  baseUrl: string,
  powerlineToken: string,
  environmentId: string,
  logger: AdapterLogger = defaultLogger,
): Promise<{ transport: AhpHostTransport; socket: AhpClientSocket }> {
  // Normalize: AHP wire is WebSocket. If baseUrl is http://...; convert to ws://...
  const wsBase = baseUrl.replace(/^http(s?):\/\//, "ws$1://");
  const url = `${wsBase}/ahp`;

  let transport: AhpHostTransport | undefined;
  const socket = new AhpClientSocket({
    url,
    powerlineToken,
    clientIdStore: new InMemoryClientIdStore(),
    clientIdKey: environmentId,
    onNotification: (n) => {
      // Lazily route to the transport once constructed. The transport binds
      // to the socket after construction (chicken-and-egg with onNotification).
      if (transport !== undefined) {
        transport.handleNotification(n);
      }
    },
    onStateChange: (state) => {
      logger.info({ environmentId, state }, "AHP transport state");
    },
  });

  await socket.open();
  transport = new AhpHostTransport(socket);
  return { transport, socket };
}

// ─── Connect Through Tunnel ─────────────────────────────────

/**
 * Connect to a PowerLine through a local tunnel port, retrying until the AHP
 * `ping` succeeds.
 *
 * @param environmentId - Stable identifier for the environment.
 * @param localPort - Local TCP port the tunnel forwards to the PowerLine.
 * @param powerlineToken - Bearer token for the PowerLine.
 * @param logger - Optional logger.
 * @returns A {@link PowerLineConnection} ready for session operations.
 */
export async function connectThroughTunnel(
  environmentId: string,
  localPort: number,
  powerlineToken: string,
  logger: AdapterLogger = defaultLogger,
): Promise<PowerLineConnection> {
  const baseUrl = `ws://127.0.0.1:${localPort}`;

  let lastError: unknown;
  for (let attempt = 0; attempt < CONNECT_MAX_RETRIES; attempt++) {
    try {
      const { transport, socket } = await createAhpHostTransport(
        baseUrl,
        powerlineToken,
        environmentId,
        logger,
      );
      // Liveness probe via AHP `ping` to verify the wire is alive.
      await socket.request("ping", { channel: "ahp-root://" });
      return {
        environmentId,
        port: localPort,
        transport,
        ping: async () => {
          await socket.request("ping", { channel: "ahp-root://" });
        },
      };
    } catch (err) {
      lastError = err;
      await sleep(CONNECT_RETRY_DELAY_MS);
    }
  }

  // Clean up the tunnel so we don't leak background processes on connect failure
  try {
    await closeTunnel(environmentId);
  } catch (err) {
    logger.error({ environmentId, err }, "Failed to close tunnel after connect failure");
  }

  throw new Error(
    `Could not reach PowerLine after ${CONNECT_MAX_RETRIES} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

// ─── Wait for Local Port ────────────────────────────────────

/** Single-shot TCP port prober used by {@link waitForLocalPort}. */
export interface PortProber {
  /** Attempt a single TCP connection to `host:port`, returning `true` if it succeeds. */
  probe(port: number, host?: string): Promise<boolean>;
}

/** Default {@link PortProber} that uses real TCP sockets. */
export const TCP_PORT_PROBER: PortProber = {
  probe(port: number, host: string = "127.0.0.1"): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = createConnection({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });
  },
};

/** Options for {@link waitForLocalPort}. */
export interface WaitForLocalPortOptions {
  /** Override port probing (primarily for testing). */
  portProber?: PortProber;
  /** Override the sleep function (primarily for testing). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Poll until a TCP connection can be established on localhost at the given port.
 * Used to wait for a tunnel process to begin accepting connections.
 */
export async function waitForLocalPort(
  port: number,
  options?: WaitForLocalPortOptions,
): Promise<void> {
  const prober = options?.portProber ?? TCP_PORT_PROBER;
  const sleepFn = options?.sleep ?? sleep;

  for (let attempt = 0; attempt < TUNNEL_PORT_POLL_MAX_ATTEMPTS; attempt++) {
    const reachable = await prober.probe(port, "127.0.0.1");

    if (reachable) {
      return;
    }
    await sleepFn(TUNNEL_PORT_POLL_DELAY_MS);
  }

  throw new Error(
    `Local port ${port} did not become reachable after ${TUNNEL_PORT_POLL_MAX_ATTEMPTS} attempts`,
  );
}
