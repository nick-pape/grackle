import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { powerline } from "@grackle-ai/common";
import { createConnection } from "node:net";
import type { PowerLineClient, PowerLineConnection } from "./adapter.js";
import { closeTunnel } from "./tunnel-registry.js";
import { sleep } from "./utils.js";
import type { AdapterLogger } from "./logger.js";
import { defaultLogger } from "./logger.js";

// ─── Constants ──────────────────────────────────────────────

/** Delay between gRPC connect-with-retry attempts. */
const CONNECT_RETRY_DELAY_MS: number = 1_500;

/** Maximum number of gRPC connect-with-retry attempts. */
const CONNECT_MAX_RETRIES: number = 10;

/** Delay between port availability polls. */
const TUNNEL_PORT_POLL_DELAY_MS: number = 500;

/** Maximum number of port availability polls. */
const TUNNEL_PORT_POLL_MAX_ATTEMPTS: number = 20;

// ─── PowerLine Client ───────────────────────────────────────

/**
 * Create an authenticated gRPC client for a PowerLine.
 * The PowerLine token is sent as a Bearer token on every request.
 */
export function createPowerLineClient(baseUrl: string, powerlineToken: string): PowerLineClient {
  const transport = createGrpcTransport({
    baseUrl,
    interceptors: powerlineToken
      ? [
          (next) => async (req) => {
            req.header.set("Authorization", `Bearer ${powerlineToken}`);
            return next(req);
          },
        ]
      : [],
  });
  return createClient(powerline.GracklePowerLine, transport);
}

// ─── Connect Through Tunnel ─────────────────────────────────

/**
 * Connect to a PowerLine through a local tunnel port, retrying until the gRPC
 * service responds to a ping.
 */
export async function connectThroughTunnel(
  environmentId: string,
  localPort: number,
  powerlineToken: string,
  logger: AdapterLogger = defaultLogger,
): Promise<PowerLineConnection> {
  const client = createPowerLineClient(`http://127.0.0.1:${localPort}`, powerlineToken);

  let lastError: unknown;
  for (let attempt = 0; attempt < CONNECT_MAX_RETRIES; attempt++) {
    try {
      await client.ping({});
      return { client, environmentId, port: localPort };
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

  throw new Error(`Could not reach PowerLine after ${CONNECT_MAX_RETRIES} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

// ─── Wait for Local Port ────────────────────────────────────

/**
 * Poll until a TCP connection can be established on localhost at the given port.
 * Used to wait for a tunnel process to begin accepting connections.
 */
export async function waitForLocalPort(port: number): Promise<void> {
  for (let attempt = 0; attempt < TUNNEL_PORT_POLL_MAX_ATTEMPTS; attempt++) {
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });

    if (reachable) {
      return;
    }
    await sleep(TUNNEL_PORT_POLL_DELAY_MS);
  }

  throw new Error(`Local port ${port} did not become reachable after ${TUNNEL_PORT_POLL_MAX_ATTEMPTS} attempts`);
}
