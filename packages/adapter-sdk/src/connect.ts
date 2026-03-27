import { createClient, type Interceptor } from "@connectrpc/connect";
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
 * When `traceId` is provided, it is forwarded as the `x-trace-id` header for request correlation.
 */
export function createPowerLineClient(baseUrl: string, powerlineToken: string, traceId?: string): PowerLineClient {
  const interceptors: Interceptor[] = [];

  if (powerlineToken) {
    interceptors.push(
      (next) => async (req) => {
        req.header.set("Authorization", `Bearer ${powerlineToken}`);
        return next(req);
      },
    );
  }

  if (traceId) {
    interceptors.push(
      (next) => async (req) => {
        req.header.set("x-trace-id", traceId);
        return next(req);
      },
    );
  }

  const transport = createGrpcTransport({
    baseUrl,
    interceptors,
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
  traceId?: string,
): Promise<PowerLineConnection> {
  const client = createPowerLineClient(`http://127.0.0.1:${localPort}`, powerlineToken, traceId);

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
export async function waitForLocalPort(port: number, options?: WaitForLocalPortOptions): Promise<void> {
  const prober = options?.portProber ?? TCP_PORT_PROBER;
  const sleepFn = options?.sleep ?? sleep;

  for (let attempt = 0; attempt < TUNNEL_PORT_POLL_MAX_ATTEMPTS; attempt++) {
    const reachable = await prober.probe(port, "127.0.0.1");

    if (reachable) {
      return;
    }
    await sleepFn(TUNNEL_PORT_POLL_DELAY_MS);
  }

  throw new Error(`Local port ${port} did not become reachable after ${TUNNEL_PORT_POLL_MAX_ATTEMPTS} attempts`);
}
