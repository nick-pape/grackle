/**
 * Test harness that lets a property-based fuzzer (or any test) drive an
 * `AhpServerSocket` + `AhpClientSocket` pair through arbitrary sequences
 * of operations and observe the resulting state. Excluded from coverage.
 */

import type { InitializeResult } from "@grackle-ai/ahp";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { AhpClientSocket, type AhpConnectionState } from "../ahp-client-socket.js";
import { exponentialBackoff } from "../backoff.js";
import { InMemoryClientIdStore } from "../client-id-store.js";
import {
  AhpServerSocket,
  type AhpServerConnection,
  type AhpServerSocketOptions,
} from "../ahp-server-socket.js";

const INIT_RESULT: InitializeResult = {
  protocolVersion: "0.1.0",
  serverSeq: 0,
  snapshots: [],
};

/** Records every state transition for invariant checks. */
export interface StateTransition {
  readonly at: number;
  readonly state: AhpConnectionState;
}

/** Per-driver state used by tests/fuzzers. */
export interface TestDriver {
  readonly client: AhpClientSocket;
  /** Set after the server has been booted. Cleared on serverDown. */
  serverConnections: AhpServerConnection[];
  /** Full history of client state transitions. */
  readonly transitions: StateTransition[];
  /** Settle-history for every request the driver issued. */
  readonly requestOutcomes: Array<"resolved" | "rejected">;
  /**
   * Set if any request promise settled MORE than once. The fuzzer asserts
   * this stays empty as invariant I3 (exactly-once settle).
   */
  readonly doubleSettleErrors: string[];

  /** Start (or restart) the server on the original port. */
  startServer(opts?: Partial<AhpServerSocketOptions>): Promise<void>;
  /** Stop the server. Existing client connections drop. */
  stopServer(): Promise<void>;
  /** Kick the most-recently-established server session. No-op if no session. */
  kickSession(): void;
  /** Issue a typed request through the client. Tracks the settle. */
  request(): Promise<void>;
  /** Send a notification through the client. */
  notify(): void;
  /** Sleep `ms` of real time. */
  wait(ms: number): Promise<void>;
  /** Close + dispose the driver. */
  dispose(): Promise<void>;
}

export interface TestDriverOptions {
  /** Backoff for the client. Defaults to tight 5ms reconnects for fuzz speed. */
  readonly backoffMs?: number;
}

export async function createTestDriver(options: TestDriverOptions = {}): Promise<TestDriver> {
  const backoffMs = options.backoffMs ?? 5;
  // Grab a free port via a brief listen-then-close. There's a small
  // theoretical race against other vitest workers that could grab the
  // same port between close and the next startServer, but in practice
  // operating systems hold recently-freed ports in TIME_WAIT long enough
  // for the test to re-bind. We tolerate the rare flake rather than pay
  // the complexity of port-keeping with a fallback upgrade handler.
  const initialServer = createServer();
  await new Promise<void>((r) => initialServer.listen(0, "127.0.0.1", r));
  const port = (initialServer.address() as AddressInfo).port;
  await new Promise<void>((r) => initialServer.close(() => r()));

  let server: Server | undefined;
  let ahp: AhpServerSocket | undefined;
  const serverConnections: AhpServerConnection[] = [];
  const transitions: StateTransition[] = [];
  const requestOutcomes: Array<"resolved" | "rejected"> = [];
  const doubleSettleErrors: string[] = [];
  let startedAt = Date.now();
  let requestSeq = 0;

  const client = new AhpClientSocket({
    url: `ws://127.0.0.1:${port}/ahp`,
    powerlineToken: "tok",
    clientIdStore: new InMemoryClientIdStore(),
    clientIdKey: "fuzz",
    backoff: exponentialBackoff({ initialMs: backoffMs, maxMs: backoffMs, jitter: 0 }),
    onStateChange: (s) => transitions.push({ at: Date.now() - startedAt, state: s }),
  });

  const driver: TestDriver = {
    client,
    serverConnections,
    transitions,
    requestOutcomes,
    doubleSettleErrors,
    async startServer(opts) {
      if (server !== undefined) {
        return;
      }
      server = createServer();
      await new Promise<void>((r) => server!.listen(port, "127.0.0.1", r));
      ahp = new AhpServerSocket({
        server,
        powerlineToken: "tok",
        onInitialize: () => INIT_RESULT,
        onConnection: (c) => serverConnections.push(c),
        onRequest: async (req) => ({
          jsonrpc: "2.0",
          id: req.id,
          result: null,
        }),
        ...opts,
      });
    },
    async stopServer() {
      if (server === undefined) {
        return;
      }
      await ahp!.close();
      await new Promise<void>((r) => server!.close(() => r()));
      server = undefined;
      ahp = undefined;
      serverConnections.length = 0;
    },
    kickSession() {
      const last = serverConnections[serverConnections.length - 1];
      if (last !== undefined) {
        last.session.close(1011, "kicked");
      }
    },
    async request() {
      const id = requestSeq++;
      let settled = false;
      const recordSettle = (outcome: "resolved" | "rejected"): void => {
        if (settled) {
          doubleSettleErrors.push(`request ${id} settled twice (last: ${outcome})`);
          return;
        }
        settled = true;
        requestOutcomes.push(outcome);
      };
      try {
        await client.request("ping", { channel: "ahp-root://" });
        recordSettle("resolved");
      } catch {
        recordSettle("rejected");
      }
    },
    notify() {
      try {
        client.notify("unsubscribe", { channel: "ahp-session:/x" });
      } catch {
        // notify is fire-and-forget; swallow
      }
    },
    async wait(ms) {
      await new Promise((r) => setTimeout(r, ms));
    },
    async dispose() {
      await client.close();
      await this.stopServer();
    },
  };

  return driver;
}
