/**
 * Loopback-integration tests for {@link MultiHostClient}. Each test wires
 * one or two {@link spinUpLoopbackHost} instances and exercises the
 * cross-host facade.
 */

import type {
  InitializeResult,
  SessionAddedParams,
  SessionSummary,
  SubscribeResult,
} from "@grackle-ai/ahp";
import { ActionType, SessionStatus } from "@grackle-ai/ahp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MultiHostClient } from "./multi-host-client.js";
import { spinUpLoopbackHost, type LoopbackHost } from "./test-fixtures.js";

const INIT_RESULT: InitializeResult = {
  protocolVersion: "0.1.0",
  serverSeq: 0,
  snapshots: [],
};

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    resource: "ahp-session:/x",
    provider: "claude-code",
    title: "T",
    status: SessionStatus.Idle,
    createdAt: 1_000_000,
    modifiedAt: 1_000_001,
    ...overrides,
  };
}

function programDefaultHost(host: LoopbackHost, sessions: readonly SessionSummary[]): void {
  host.setOnInitialize(() => INIT_RESULT);
  host.setOnRequest(async (req) => {
    if (req.method === "listSessions") {
      return { jsonrpc: "2.0", id: req.id, result: { items: [...sessions] } };
    }
    if (req.method === "subscribe") {
      const result: SubscribeResult = { snapshot: undefined };
      return { jsonrpc: "2.0", id: req.id, result };
    }
    return { jsonrpc: "2.0", id: req.id, result: null };
  });
}

async function waitOpen(client: MultiHostClient, envId: string): Promise<void> {
  // Await the supervisor's open() promise (idempotent) so the test runs
  // AFTER the full open-path has completed — including the initial
  // listSessions() that primes the SessionCache.
  const supervisor = client.host(envId);
  if (supervisor === undefined) {
    throw new Error(`waitOpen: no host registered for '${envId}'`);
  }
  await supervisor.open();
}

describe("MultiHostClient", () => {
  let hostA: LoopbackHost;
  let hostB: LoopbackHost;
  let client: MultiHostClient | undefined;

  beforeEach(async () => {
    hostA = await spinUpLoopbackHost();
    hostB = await spinUpLoopbackHost();
  });

  afterEach(async () => {
    if (client !== undefined) {
      await client.close();
      client = undefined;
    }
    await hostA.close();
    await hostB.close();
  });

  it("addHost registers a per-environmentId supervisor; environmentIds reflects registration", () => {
    programDefaultHost(hostA, []);
    client = new MultiHostClient();
    client.addHost({
      environmentId: "a",
      baseUrl: hostA.url,
      powerlineToken: hostA.powerlineToken,
    });
    expect(client.environmentIds()).toEqual(["a"]);
  });

  it("addHost throws when environmentId is already registered", () => {
    programDefaultHost(hostA, []);
    client = new MultiHostClient();
    client.addHost({
      environmentId: "a",
      baseUrl: hostA.url,
      powerlineToken: hostA.powerlineToken,
    });
    expect(() =>
      client!.addHost({
        environmentId: "a",
        baseUrl: hostA.url,
        powerlineToken: hostA.powerlineToken,
      }),
    ).toThrow(/already registered/);
  });

  it("request routes to the named host and rejects unknown envIds", async () => {
    programDefaultHost(hostA, [makeSummary({ resource: "ahp-session:/a-only" })]);
    programDefaultHost(hostB, [makeSummary({ resource: "ahp-session:/b-only" })]);
    client = new MultiHostClient();
    client.addHost({
      environmentId: "a",
      baseUrl: hostA.url,
      powerlineToken: hostA.powerlineToken,
    });
    client.addHost({
      environmentId: "b",
      baseUrl: hostB.url,
      powerlineToken: hostB.powerlineToken,
    });
    await Promise.all([waitOpen(client, "a"), waitOpen(client, "b")]);
    const resA = await client.request("a", "listSessions", { channel: "ahp-root://" });
    const resB = await client.request("b", "listSessions", { channel: "ahp-root://" });
    expect(resA.items[0]?.resource).toBe("ahp-session:/a-only");
    expect(resB.items[0]?.resource).toBe("ahp-session:/b-only");
    await expect(
      client.request("ghost", "listSessions", { channel: "ahp-root://" }),
    ).rejects.toThrow(/no host registered/);
  });

  it("subscribe routes to the right host; actions on host A do not appear on host B's subscriber", async () => {
    programDefaultHost(hostA, []);
    programDefaultHost(hostB, []);
    client = new MultiHostClient();
    client.addHost({
      environmentId: "a",
      baseUrl: hostA.url,
      powerlineToken: hostA.powerlineToken,
    });
    client.addHost({
      environmentId: "b",
      baseUrl: hostB.url,
      powerlineToken: hostB.powerlineToken,
    });
    await Promise.all([waitOpen(client, "a"), waitOpen(client, "b")]);

    // Collect from B in the background; we expect zero non-unavailable items.
    const bSeen: SubscriptionMessage[] = [];
    const bCollector = (async (): Promise<void> => {
      for await (const msg of client.subscribe("b", "ahp-session:/x")) {
        if (msg.kind === "unavailable") {
          return;
        }
        bSeen.push(msg);
      }
    })();

    // Subscribe A and verify it sees the action.
    const itA = client.subscribe("a", "ahp-session:/x")[Symbol.asyncIterator]();
    hostA.pushNotification("action", {
      channel: "ahp-session:/x",
      serverSeq: 1,
      action: { type: ActionType.SessionTitleChanged, title: "from-A" },
      origin: undefined,
    });
    const a = await itA.next();
    expect(a.value?.kind).toBe("action");
    if (a.value?.kind === "action") {
      expect((a.value.action as { title: string }).title).toBe("from-A");
    }

    // Give the event loop time to deliver any stray messages to B that
    // might have leaked across hosts (sanity check — there should be none).
    await new Promise((r) => setTimeout(r, 100));

    // Tear down B via removeHost — this closes the supervisor, which closes
    // the subscriber queue and lets bCollector exit cleanly.
    await client.removeHost("b");
    await bCollector;
    expect(bSeen).toEqual([]);
    await itA.return?.();
  });

  it("aggregatedSessions unions across hosts, tagged with environmentId; root/sessionAdded updates the next read", async () => {
    programDefaultHost(hostA, [
      makeSummary({ resource: "ahp-session:/a1", title: "A-one" }),
      makeSummary({ resource: "ahp-session:/a2", title: "A-two" }),
    ]);
    programDefaultHost(hostB, [makeSummary({ resource: "ahp-session:/b1", title: "B-one" })]);
    client = new MultiHostClient();
    client.addHost({
      environmentId: "a",
      baseUrl: hostA.url,
      powerlineToken: hostA.powerlineToken,
    });
    client.addHost({
      environmentId: "b",
      baseUrl: hostB.url,
      powerlineToken: hostB.powerlineToken,
    });
    await Promise.all([waitOpen(client, "a"), waitOpen(client, "b")]);
    const initial = await client.aggregatedSessions();
    const envCounts = new Map<string, number>();
    for (const row of initial) {
      envCounts.set(row.environmentId, (envCounts.get(row.environmentId) ?? 0) + 1);
    }
    expect(envCounts.get("a")).toBe(2);
    expect(envCounts.get("b")).toBe(1);

    // Push root/sessionAdded on host B and re-read.
    const params: SessionAddedParams = {
      channel: "ahp-root://",
      summary: makeSummary({ resource: "ahp-session:/b2", title: "B-two" }),
    };
    hostB.pushNotification("root/sessionAdded", params);
    await new Promise((r) => setTimeout(r, 40));
    const after = await client.aggregatedSessions();
    expect(after.length).toBe(4);
    const bTitles = after.filter((r) => r.environmentId === "b").map((r) => r.summary.title);
    expect(bTitles.sort()).toEqual(["B-one", "B-two"]);
  });

  it("aggregatedSessions includes whatever a still-reconnecting host has cached without blocking", async () => {
    programDefaultHost(hostA, [makeSummary({ resource: "ahp-session:/a1", title: "A-one" })]);
    programDefaultHost(hostB, [makeSummary({ resource: "ahp-session:/b1", title: "B-one" })]);
    client = new MultiHostClient();
    client.addHost({
      environmentId: "a",
      baseUrl: hostA.url,
      powerlineToken: hostA.powerlineToken,
    });
    client.addHost({
      environmentId: "b",
      baseUrl: hostB.url,
      powerlineToken: hostB.powerlineToken,
    });
    await Promise.all([waitOpen(client, "a"), waitOpen(client, "b")]);
    // Kick host B; it'll reconnect in the background but we want the read to return without blocking.
    hostB.kick();
    const t0 = Date.now();
    const rows = await client.aggregatedSessions();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(50); // synchronous read into Promise.resolve
    // Host A's row is always present; host B's row may or may not still be cached depending on timing.
    expect(rows.some((r) => r.environmentId === "a")).toBe(true);
  });

  it("generation(envId) returns the per-host counter; advances after a forced reconnect", async () => {
    programDefaultHost(hostA, []);
    client = new MultiHostClient();
    client.addHost({
      environmentId: "a",
      baseUrl: hostA.url,
      powerlineToken: hostA.powerlineToken,
    });
    await waitOpen(client, "a");
    expect(client.generation("a")).toBe(1);
    hostA.kick();
    await new Promise<void>((resolve) => {
      const unsub = client!.onStateChange("a", (state) => {
        if (state === "open") {
          unsub();
          resolve();
        }
      });
    });
    expect(client.generation("a")).toBe(2);
  });

  it("removeHost closes the named supervisor without affecting the other host", async () => {
    programDefaultHost(hostA, []);
    programDefaultHost(hostB, []);
    client = new MultiHostClient();
    client.addHost({
      environmentId: "a",
      baseUrl: hostA.url,
      powerlineToken: hostA.powerlineToken,
    });
    client.addHost({
      environmentId: "b",
      baseUrl: hostB.url,
      powerlineToken: hostB.powerlineToken,
    });
    await Promise.all([waitOpen(client, "a"), waitOpen(client, "b")]);
    await client.removeHost("a");
    expect(client.environmentIds()).toEqual(["b"]);
    // request to "a" now throws
    await expect(client.request("a", "listSessions", { channel: "ahp-root://" })).rejects.toThrow(
      /no host registered/,
    );
    // request to "b" still works
    await expect(client.request("b", "listSessions", { channel: "ahp-root://" })).resolves.toEqual({
      items: [],
    });
  });

  it("removeHost is a no-op for unknown environmentIds", async () => {
    client = new MultiHostClient();
    await expect(client.removeHost("missing")).resolves.toBeUndefined();
  });

  it("close() closes every supervisor; further calls reject; idempotent", async () => {
    programDefaultHost(hostA, []);
    programDefaultHost(hostB, []);
    client = new MultiHostClient();
    client.addHost({
      environmentId: "a",
      baseUrl: hostA.url,
      powerlineToken: hostA.powerlineToken,
    });
    client.addHost({
      environmentId: "b",
      baseUrl: hostB.url,
      powerlineToken: hostB.powerlineToken,
    });
    await Promise.all([waitOpen(client, "a"), waitOpen(client, "b")]);
    await client.close();
    expect(() =>
      client!.addHost({
        environmentId: "c",
        baseUrl: hostA.url,
        powerlineToken: hostA.powerlineToken,
      }),
    ).toThrow(/after close/);
    expect(() => client!.getHostState("a")).toThrow(/after close/);
    await expect(client.close()).resolves.toBeUndefined();
    client = undefined;
  });

  it("host(envId) returns the supervisor handle; undefined for unknown ids", async () => {
    programDefaultHost(hostA, []);
    client = new MultiHostClient();
    const supervisor = client.addHost({
      environmentId: "a",
      baseUrl: hostA.url,
      powerlineToken: hostA.powerlineToken,
    });
    expect(client.host("a")).toBe(supervisor);
    expect(client.host("missing")).toBeUndefined();
  });
});
