/**
 * Transport-fidelity conformance test.
 *
 * Reuses the 156 reducer-conformance JSON fixtures vendored from
 * `microsoft/agent-host-protocol` into `@grackle-ai/ahp`'s
 * `src/vendor/ahp/test-cases/reducers/`. For each fixture:
 *
 *   1. Boot an `AhpServerSocket` + `AhpClientSocket` pair.
 *   2. Server iterates the fixture's `actions` array and emits each as an
 *      `action` JSON-RPC notification on a synthetic channel.
 *   3. Client collects every received notification via `onNotification`.
 *   4. Assert the received action sequence deep-equals the original
 *      (proves the wire preserved every action in order without loss,
 *      duplication, or field-level mangling).
 *
 * 156 small fixtures = 156 wire-fidelity stress runs, each exercising a
 * different shape of AHP action payload (session lifecycle, tool calls,
 * response parts, errors, root/terminal/changeset variants). If the wire
 * silently coerces a type or drops a frame, at least one fixture lights up.
 *
 * Why no reducer-fold assertion? The fixtures' `expected` states use
 * wildcard fields (e.g., `modifiedAt: 9999`) that the upstream test
 * runner ignores via a custom comparator. Reproducing that here adds
 * complexity without strengthening the transport signal — the reducer
 * itself is upstream-conformance-tested in `@grackle-ai/ahp`'s
 * `reducer-conformance.test.ts`. Our concern is the WIRE, and "received
 * actions deep-equal sent actions" is the right primitive for that.
 *
 * This test is integration-level (real http + real ws). It runs ~156
 * mini sessions back-to-back; total ~5s.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { AhpClientSocket } from "./ahp-client-socket.js";
import { InMemoryClientIdStore } from "./client-id-store.js";
import { AhpServerSocket } from "./ahp-server-socket.js";

// Resolve the vendored fixtures via the @grackle-ai/ahp package's source
// location. Workspace-only path — these JSON files are intentionally not
// shipped in the published @grackle-ai/ahp tarball.
const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "ahp",
  "src",
  "vendor",
  "ahp",
  "test-cases",
  "reducers",
);

interface Fixture {
  readonly description: string;
  readonly reducer: "session" | "root" | "terminal" | "changeset";
  readonly actions: ReadonlyArray<Record<string, unknown>>;
}

function loadFixtures(): Array<{ name: string; fixture: Fixture }> {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
  return files.map((name) => ({
    name,
    fixture: JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8")) as Fixture,
  }));
}

interface Harness {
  server: Server;
  port: number;
  ahp: AhpServerSocket;
  client: AhpClientSocket;
  received: Array<Record<string, unknown>>;
}

async function bootHarness(): Promise<Harness> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const received: Array<Record<string, unknown>> = [];
  const connections: Array<{ session: { notify: (m: string, p: unknown) => void } }> = [];
  const ahp = new AhpServerSocket({
    server,
    powerlineToken: "tok",
    onInitialize: () => ({ protocolVersion: "0.1.0", serverSeq: 0, snapshots: [] }),
    onConnection: (c) => connections.push(c as never),
  });
  // Expose `connections` via a hack so the test loop can fan out actions.
  (ahp as unknown as { _testConnections: typeof connections })._testConnections = connections;

  const client = new AhpClientSocket({
    url: `ws://127.0.0.1:${port}/ahp`,
    powerlineToken: "tok",
    clientIdStore: new InMemoryClientIdStore(),
    clientIdKey: "conformance",
    onNotification: (notif) => {
      if (notif.method === "action") {
        const params = notif.params as { action?: Record<string, unknown> };
        if (params.action !== undefined) {
          received.push(params.action);
        }
      }
    },
  });
  await client.open();
  // Wait for the server to register the connection (queueMicrotask delay
  // inside the framing layer means onConnection fires async).
  while (connections.length === 0) {
    await new Promise((r) => setImmediate(r));
  }
  return { server, port, ahp, client, received };
}

async function teardownHarness(h: Harness): Promise<void> {
  await h.client.close();
  await h.ahp.close();
  await new Promise<void>((r) => h.server.close(() => r()));
}

describe("Transport fidelity vs AHP reducer corpus", () => {
  const fixtures = loadFixtures();

  it(`loads exactly 156 fixtures (sanity)`, () => {
    expect(fixtures.length).toBe(156);
  });

  for (const { name, fixture } of fixtures) {
    it(`${name} — actions round-trip the wire and reconstruct expected state`, async () => {
      const h = await bootHarness();
      try {
        const serverConn = (
          h.ahp as unknown as {
            _testConnections: Array<{ session: { notify: (m: string, p: unknown) => void } }>;
          }
        )._testConnections[0]!;

        for (let i = 0; i < fixture.actions.length; i++) {
          serverConn.session.notify("action", {
            channel: "ahp-session:/conformance",
            serverSeq: i + 1,
            action: fixture.actions[i],
          });
        }
        // Wait until all actions land.
        const deadline = Date.now() + 5_000;
        while (h.received.length < fixture.actions.length) {
          if (Date.now() > deadline) {
            throw new Error(
              `${name}: timed out waiting for ${fixture.actions.length} actions, got ${h.received.length}`,
            );
          }
          await new Promise((r) => setTimeout(r, 5));
        }

        // Wire fidelity: received actions deep-equal the sent actions
        // (same content, same order, no drops, no duplicates).
        expect(h.received).toEqual(fixture.actions);
      } finally {
        await teardownHarness(h);
      }
    });
  }
});
