/**
 * In-process loopback host fixture for `ahp-client` tests. Spins up a real
 * `http.Server` + `AhpServerSocket` on a random localhost port; tests
 * connect their `HostSupervisor` / `MultiHostClient` through real `ws`.
 *
 * Modeled on `packages/ahp-transport/src/loopback.integration.test.ts` and
 * `packages/ahp-transport/src/mocks/test-driver.ts`. The HR8a `test-driver`
 * lives behind that package's barrel; we re-implement the slim subset HR8b
 * needs rather than pull a dependency edge on internal test utilities.
 *
 * @internal — not exported from the public barrel.
 */

import type {
  AhpNotification,
  AhpRequest,
  AhpResponse,
  InitializeParams,
  InitializeResult,
} from "@grackle-ai/ahp";
import { AhpServerSocket, type AhpServerConnection, WsCloseCode } from "@grackle-ai/ahp-transport";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const DEFAULT_TOKEN = "test-token";

/** Default `InitializeResult` returned when no test override is provided. */
const DEFAULT_INIT_RESULT: InitializeResult = {
  protocolVersion: "0.1.0",
  serverSeq: 0,
  snapshots: [],
};

/** Test-controllable host handle. */
export interface LoopbackHost {
  readonly url: string;
  readonly powerlineToken: string;
  /** All AHP connections accepted by the server, in arrival order. */
  readonly connections: ReadonlyArray<AhpServerConnection>;
  /** Inbound notifications recorded for assertions, in arrival order. */
  readonly inboundNotifications: ReadonlyArray<{
    method: string;
    params: unknown;
    fromClientId: string;
  }>;
  /** The most recent server-side connection, or undefined before the first client. */
  latestConnection(): AhpServerConnection | undefined;
  /** Replace the initialize handler at any point. */
  setOnInitialize(
    handler: (params: InitializeParams) => Promise<InitializeResult> | InitializeResult,
  ): void;
  /** Replace the request handler (non-`initialize` requests). */
  setOnRequest(handler: (req: AhpRequest, conn: AhpServerConnection) => Promise<AhpResponse>): void;
  /** Hook into client→server notifications (after the default recorder runs). */
  setOnNotification(handler: (n: AhpNotification, conn: AhpServerConnection) => void): void;
  /** Push a server→client notification to the most recent connection. */
  pushNotification(method: string, params: unknown): void;
  /** Force-close the latest connection (simulate server kicking the client). */
  kick(code?: number, reason?: string): void;
  /** Tear down the server. Idempotent. */
  close(): Promise<void>;
}

/** Options for {@link spinUpLoopbackHost}. */
export interface LoopbackHostOptions {
  readonly powerlineToken?: string;
}

/**
 * Bind a real localhost server, mount an {@link AhpServerSocket} on it, and
 * return a test handle. Tests are responsible for calling {@link LoopbackHost.close}
 * in their `afterEach` (or `try`/`finally`).
 */
export async function spinUpLoopbackHost(options: LoopbackHostOptions = {}): Promise<LoopbackHost> {
  const powerlineToken = options.powerlineToken ?? DEFAULT_TOKEN;
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  const connections: AhpServerConnection[] = [];
  const inboundNotifications: Array<{ method: string; params: unknown; fromClientId: string }> = [];

  let onInitialize: (
    params: InitializeParams,
  ) => Promise<InitializeResult> | InitializeResult = () => DEFAULT_INIT_RESULT;
  let onRequest: (req: AhpRequest, conn: AhpServerConnection) => Promise<AhpResponse> = async (
    req,
  ) => ({ jsonrpc: "2.0", id: req.id, result: null });
  let onNotificationExtra: ((n: AhpNotification, conn: AhpServerConnection) => void) | undefined;

  const ahp = new AhpServerSocket({
    server,
    powerlineToken,
    onInitialize: (params) => onInitialize(params),
    onConnection: (c) => connections.push(c),
    onRequest: (req, conn) => onRequest(req, conn),
    onNotification: (n, conn) => {
      inboundNotifications.push({
        method: n.method,
        params: n.params,
        fromClientId: conn.clientId,
      });
      onNotificationExtra?.(n, conn);
    },
  });

  let closed = false;

  const host: LoopbackHost = {
    url: `ws://127.0.0.1:${port}/ahp`,
    powerlineToken,
    connections,
    inboundNotifications,
    latestConnection(): AhpServerConnection | undefined {
      return connections[connections.length - 1];
    },
    setOnInitialize(handler) {
      onInitialize = handler;
    },
    setOnRequest(handler) {
      onRequest = handler;
    },
    setOnNotification(handler) {
      onNotificationExtra = handler;
    },
    pushNotification(method, params) {
      const conn = host.latestConnection();
      if (conn === undefined) {
        throw new Error("pushNotification: no client connected");
      }
      conn.session.notify(method, params);
    },
    kick(code = WsCloseCode.HeartbeatTimeout, reason = "kicked") {
      const conn = host.latestConnection();
      if (conn === undefined) {
        return;
      }
      conn.session.close(code, reason);
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await ahp.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };

  return host;
}

/** Smoke-test the helper itself so we catch regressions in the harness. */
export const __testFixtureSmoke = { spinUpLoopbackHost };
