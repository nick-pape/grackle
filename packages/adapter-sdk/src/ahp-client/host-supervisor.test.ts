/**
 * Loopback-integration tests for {@link HostSupervisor}. Each test spins up
 * a real `http.Server` + `AhpServerSocket` (via {@link spinUpLoopbackHost})
 * and connects a single supervisor to it, exercising the supervisor's
 * happy paths and reconnect/dedup behavior.
 */

import type {
  ActionEnvelope,
  AuthRequiredParams,
  InitializeParams,
  InitializeResult,
  ListSessionsResult,
  RootState,
  SessionAddedParams,
  SessionRemovedParams,
  SessionState,
  SessionSummary,
  SessionSummaryChangedParams,
  Snapshot,
  SubscribeParams,
  SubscribeResult,
  UnsubscribeParams,
  URI,
} from "@grackle-ai/ahp";
import {
  ActionType,
  AuthRequiredReason,
  PolicyState,
  SessionLifecycle,
  SessionStatus,
  TurnState,
} from "@grackle-ai/ahp";
import { InMemoryClientIdStore } from "@grackle-ai/ahp-transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HostSupervisor } from "./host-supervisor.js";
import { spinUpLoopbackHost, type LoopbackHost } from "./test-fixtures.js";
import type { SubscriptionMessage } from "./types.js";

const ENV_ID = "env-test";
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

function makeRootState(): RootState {
  return {
    config: { properties: {} },
    agents: [],
    activeSessions: [],
    terminals: [],
  };
}

function makeSessionState(turnId: string = "turn-1"): SessionState {
  return {
    summary: makeSummary({ resource: "ahp-session:/x" }),
    lifecycle: SessionLifecycle.Active,
    activeClient: undefined,
    serverTools: [],
    clientTools: [],
    customizations: { agents: [] },
    turns: [
      {
        turnId,
        state: TurnState.Pending,
        responseParts: [],
      },
    ],
    pendingMessages: [],
    inputRequests: [],
    changesets: [],
    isRead: true,
    isArchived: false,
    policy: PolicyState.Allow,
    meta: {},
  };
}

function makeSnapshot(channel: URI, fromSeq: number): Snapshot {
  return {
    resource: channel,
    state: channel === "ahp-root://" ? makeRootState() : makeSessionState(),
    fromSeq,
  };
}

/**
 * Collect at most `n` events from an iterable, or until it closes. Bails
 * after `timeoutMs` so failing tests don't hang the suite.
 */
async function collectN(
  iter: AsyncIterable<SubscriptionMessage>,
  n: number,
  timeoutMs: number = 2000,
): Promise<SubscriptionMessage[]> {
  const result: SubscriptionMessage[] = [];
  const deadline = Date.now() + timeoutMs;
  const it = iter[Symbol.asyncIterator]();
  while (result.length < n) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`collectN timed out after ${timeoutMs}ms with ${result.length}/${n} events`);
    }
    const winner = await Promise.race([
      it.next(),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), remaining)),
    ]);
    if (winner === "timeout") {
      throw new Error(`collectN timed out after ${timeoutMs}ms with ${result.length}/${n} events`);
    }
    if (winner.done === true) {
      return result;
    }
    result.push(winner.value);
  }
  return result;
}

async function waitForState(
  supervisor: HostSupervisor,
  target: "open" | "closed" | "reconnecting",
  timeoutMs: number = 2000,
): Promise<void> {
  if (supervisor.state === target) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`waitForState(${target}) timed out (state is '${supervisor.state}')`));
    }, timeoutMs);
    const unsub = supervisor.onStateChange((state) => {
      if (state === target) {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    });
  });
}

describe("HostSupervisor", () => {
  let host: LoopbackHost;
  let supervisor: HostSupervisor | undefined;

  beforeEach(async () => {
    host = await spinUpLoopbackHost();
  });

  afterEach(async () => {
    if (supervisor !== undefined) {
      await supervisor.close();
      supervisor = undefined;
    }
    await host.close();
  });

  function buildSupervisor(
    opts: {
      onAuthRequired?: (p: AuthRequiredParams) => void;
      onTelemetry?: (stream: "logs" | "traces" | "metrics", params: unknown) => void;
    } = {},
  ): HostSupervisor {
    const built = new HostSupervisor({
      host: {
        environmentId: ENV_ID,
        baseUrl: host.url,
        powerlineToken: host.powerlineToken,
      },
      clientIdStore: new InMemoryClientIdStore(),
      ...(opts.onAuthRequired !== undefined ? { onAuthRequired: opts.onAuthRequired } : {}),
      ...(opts.onTelemetry !== undefined ? { onTelemetry: opts.onTelemetry } : {}),
    });
    supervisor = built;
    return built;
  }

  // ─── Connect path ────────────────────────────────────────────────

  it("reaches state 'open', bumps generation to 1, and primes the session cache via listSessions", async () => {
    const cachedSessions: SessionSummary[] = [
      makeSummary({ resource: "ahp-session:/a", title: "A" }),
      makeSummary({ resource: "ahp-session:/b", title: "B" }),
    ];
    host.setOnInitialize(() => INIT_RESULT);
    host.setOnRequest(async (req) => {
      if (req.method === "listSessions") {
        const result: ListSessionsResult = { items: cachedSessions };
        return { jsonrpc: "2.0", id: req.id, result };
      }
      return { jsonrpc: "2.0", id: req.id, result: null };
    });
    const s = buildSupervisor();
    await s.open();
    expect(s.state).toBe("open");
    expect(s.generation()).toBe(1);
    expect(
      s
        .listSessionSummaries()
        .map((x) => x.title)
        .sort(),
    ).toEqual(["A", "B"]);
  });

  // ─── Subscribe path ──────────────────────────────────────────────

  it("subscribe yields the snapshot returned by SubscribeResult", async () => {
    host.setOnInitialize(() => INIT_RESULT);
    const snapshot = makeSnapshot("ahp-session:/x", 7);
    host.setOnRequest(async (req) => {
      if (req.method === "subscribe") {
        const result: SubscribeResult = { snapshot };
        return { jsonrpc: "2.0", id: req.id, result };
      }
      if (req.method === "listSessions") {
        return { jsonrpc: "2.0", id: req.id, result: { items: [] } };
      }
      return { jsonrpc: "2.0", id: req.id, result: null };
    });
    const s = buildSupervisor();
    await s.open();
    const iter = s.subscribe("ahp-session:/x");
    const [first] = await collectN(iter, 1);
    expect(first?.kind).toBe("snapshot");
    expect(first?.serverSeq).toBe(7);
    if (first?.kind === "snapshot") {
      expect(first.snapshot.resource).toBe("ahp-session:/x");
    }
  });

  it("subscribe yields action events delivered via the action notification", async () => {
    host.setOnInitialize(() => INIT_RESULT);
    host.setOnRequest(async (req) => {
      if (req.method === "subscribe") {
        const result: SubscribeResult = { snapshot: makeSnapshot("ahp-session:/x", 0) };
        return { jsonrpc: "2.0", id: req.id, result };
      }
      if (req.method === "listSessions") {
        return { jsonrpc: "2.0", id: req.id, result: { items: [] } };
      }
      return { jsonrpc: "2.0", id: req.id, result: null };
    });
    const s = buildSupervisor();
    await s.open();
    const iter = s.subscribe("ahp-session:/x");
    // Drain the leading snapshot first.
    await collectN(iter, 1);
    const envelope: ActionEnvelope = {
      channel: "ahp-session:/x",
      serverSeq: 2,
      action: {
        type: ActionType.SessionTitleChanged,
        title: "new title",
      },
      origin: undefined,
    };
    host.pushNotification("action", envelope);
    const [next] = await collectN(iter, 1);
    expect(next?.kind).toBe("action");
    expect(next?.serverSeq).toBe(2);
    if (next?.kind === "action") {
      expect(next.action.type).toBe(ActionType.SessionTitleChanged);
    }
  });

  it("dedups action envelopes whose serverSeq is not greater than the last applied", async () => {
    host.setOnInitialize(() => INIT_RESULT);
    host.setOnRequest(async (req) => {
      if (req.method === "subscribe") {
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: { snapshot: makeSnapshot("ahp-session:/x", 0) } as SubscribeResult,
        };
      }
      if (req.method === "listSessions") {
        return { jsonrpc: "2.0", id: req.id, result: { items: [] } };
      }
      return { jsonrpc: "2.0", id: req.id, result: null };
    });
    const s = buildSupervisor();
    await s.open();
    const iter = s.subscribe("ahp-session:/x");
    await collectN(iter, 1); // snapshot

    const envelope = (serverSeq: number): ActionEnvelope => ({
      channel: "ahp-session:/x",
      serverSeq,
      action: { type: ActionType.SessionTitleChanged, title: `t${serverSeq}` },
      origin: undefined,
    });
    host.pushNotification("action", envelope(3));
    host.pushNotification("action", envelope(3)); // duplicate
    host.pushNotification("action", envelope(2)); // stale
    host.pushNotification("action", envelope(4));

    const events = await collectN(iter, 2);
    expect(events.map((e) => e.serverSeq)).toEqual([3, 4]);
  });

  it("late subscribers to the same channel attach without a fresh subscribe RPC; only one unsubscribe fires when both drop", async () => {
    host.setOnInitialize(() => INIT_RESULT);
    let subscribeCount = 0;
    host.setOnRequest(async (req) => {
      if (req.method === "subscribe") {
        subscribeCount++;
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: { snapshot: makeSnapshot("ahp-session:/x", 0) } as SubscribeResult,
        };
      }
      if (req.method === "listSessions") {
        return { jsonrpc: "2.0", id: req.id, result: { items: [] } };
      }
      return { jsonrpc: "2.0", id: req.id, result: null };
    });
    const s = buildSupervisor();
    await s.open();

    const iter1 = s.subscribe("ahp-session:/x");
    const it1 = iter1[Symbol.asyncIterator]();
    await it1.next(); // snapshot

    const iter2 = s.subscribe("ahp-session:/x");
    const it2 = iter2[Symbol.asyncIterator]();

    // Push one action; both subscribers should see it.
    host.pushNotification("action", {
      channel: "ahp-session:/x",
      serverSeq: 5,
      action: { type: ActionType.SessionTitleChanged, title: "n" },
      origin: undefined,
    });
    const [r1, r2] = await Promise.all([it1.next(), it2.next()]);
    expect(r1.value?.serverSeq).toBe(5);
    expect(r2.value?.serverSeq).toBe(5);

    // Tear down both subscribers; track inbound unsubscribe notifications.
    await it1.return?.();
    await it2.return?.();
    // Let the server-side notification recorder catch up.
    await new Promise((r) => setTimeout(r, 50));
    expect(subscribeCount).toBe(1);
    const unsubs = host.inboundNotifications.filter((n) => n.method === "unsubscribe");
    expect(unsubs).toHaveLength(1);
    expect((unsubs[0]!.params as UnsubscribeParams).channel).toBe("ahp-session:/x");
  });

  it("if subscribe RPC fails, the channel's subscribers receive 'unavailable' and the iterable closes", async () => {
    host.setOnInitialize(() => INIT_RESULT);
    host.setOnRequest(async (req) => {
      if (req.method === "subscribe") {
        return {
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32602, message: "no such channel" },
        };
      }
      if (req.method === "listSessions") {
        return { jsonrpc: "2.0", id: req.id, result: { items: [] } };
      }
      return { jsonrpc: "2.0", id: req.id, result: null };
    });
    const s = buildSupervisor();
    await s.open();
    const iter = s.subscribe("ahp-session:/missing");
    const events: SubscriptionMessage[] = [];
    for await (const ev of iter) {
      events.push(ev);
    }
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("unavailable");
  });

  // ─── dispatchAction ──────────────────────────────────────────────

  it("dispatchAction sends a notification with monotone clientSeq starting at 1", async () => {
    host.setOnInitialize(() => INIT_RESULT);
    host.setOnRequest(async (req) => ({ jsonrpc: "2.0", id: req.id, result: { items: [] } }));
    const s = buildSupervisor();
    await s.open();
    s.dispatchAction("ahp-session:/x", {
      type: ActionType.SessionTurnStarted,
      turnId: "t1",
      userMessage: { parts: [{ kind: "text", text: "hi" }] },
    });
    s.dispatchAction("ahp-session:/x", {
      type: ActionType.SessionTurnStarted,
      turnId: "t2",
      userMessage: { parts: [{ kind: "text", text: "yo" }] },
    });
    // Let server side record.
    await new Promise((r) => setTimeout(r, 30));
    const dispatches = host.inboundNotifications.filter((n) => n.method === "dispatchAction");
    expect(dispatches).toHaveLength(2);
    const seqs = dispatches.map((d) => (d.params as { clientSeq: number }).clientSeq);
    expect(seqs).toEqual([1, 2]);
  });

  it("dispatchAction throws synchronously for non-client-dispatchable actions", async () => {
    host.setOnInitialize(() => INIT_RESULT);
    host.setOnRequest(async (req) => ({ jsonrpc: "2.0", id: req.id, result: { items: [] } }));
    const s = buildSupervisor();
    await s.open();
    expect(() =>
      // `SessionReady` is server-emitted only.
      s.dispatchAction("ahp-session:/x", {
        type: ActionType.SessionReady,
        state: makeSessionState(),
      } as never),
    ).toThrow(/not client-dispatchable/);
    await new Promise((r) => setTimeout(r, 20));
    const dispatches = host.inboundNotifications.filter((n) => n.method === "dispatchAction");
    expect(dispatches).toHaveLength(0);
  });

  // ─── Notifications → session cache ───────────────────────────────

  it("root/sessionAdded inserts into the cache", async () => {
    host.setOnInitialize(() => INIT_RESULT);
    host.setOnRequest(async (req) => ({ jsonrpc: "2.0", id: req.id, result: { items: [] } }));
    const s = buildSupervisor();
    await s.open();
    const params: SessionAddedParams = {
      channel: "ahp-root://",
      summary: makeSummary({ resource: "ahp-session:/new", title: "fresh" }),
    };
    host.pushNotification("root/sessionAdded", params);
    await new Promise((r) => setTimeout(r, 30));
    expect(s.listSessionSummaries().map((x) => x.title)).toEqual(["fresh"]);
  });

  it("root/sessionRemoved drops the entry", async () => {
    host.setOnInitialize(() => INIT_RESULT);
    host.setOnRequest(async (req) => ({
      jsonrpc: "2.0",
      id: req.id,
      result: { items: [makeSummary({ resource: "ahp-session:/a" })] },
    }));
    const s = buildSupervisor();
    await s.open();
    const params: SessionRemovedParams = { channel: "ahp-root://", session: "ahp-session:/a" };
    host.pushNotification("root/sessionRemoved", params);
    await new Promise((r) => setTimeout(r, 30));
    expect(s.listSessionSummaries()).toHaveLength(0);
  });

  it("root/sessionSummaryChanged merges partial updates", async () => {
    host.setOnInitialize(() => INIT_RESULT);
    host.setOnRequest(async (req) => ({
      jsonrpc: "2.0",
      id: req.id,
      result: {
        items: [makeSummary({ resource: "ahp-session:/a", title: "old", modifiedAt: 100 })],
      },
    }));
    const s = buildSupervisor();
    await s.open();
    const params: SessionSummaryChangedParams = {
      channel: "ahp-root://",
      session: "ahp-session:/a",
      changes: { title: "new", modifiedAt: 200 },
    };
    host.pushNotification("root/sessionSummaryChanged", params);
    await new Promise((r) => setTimeout(r, 30));
    const list = s.listSessionSummaries();
    expect(list[0]?.title).toBe("new");
    expect(list[0]?.modifiedAt).toBe(200);
  });

  // ─── auth/required & otlp/* listener slots ───────────────────────

  it("auth/required listener fires with the params; otlp/exportLogs forwards to telemetry listener", async () => {
    host.setOnInitialize(() => INIT_RESULT);
    host.setOnRequest(async (req) => ({ jsonrpc: "2.0", id: req.id, result: { items: [] } }));
    const onAuth = vi.fn();
    const onTelemetry = vi.fn();
    const s = buildSupervisor({ onAuthRequired: onAuth, onTelemetry });
    await s.open();
    const authParams: AuthRequiredParams = {
      channel: "ahp-root://",
      reason: AuthRequiredReason.MissingCredentials,
      requestId: "r1",
      message: "log in",
    };
    host.pushNotification("auth/required", authParams);
    host.pushNotification("otlp/exportLogs", { resourceLogs: [] });
    host.pushNotification("otlp/exportTraces", { resourceSpans: [] });
    host.pushNotification("otlp/exportMetrics", { resourceMetrics: [] });
    await new Promise((r) => setTimeout(r, 50));
    expect(onAuth).toHaveBeenCalledWith(authParams);
    expect(onTelemetry).toHaveBeenCalledTimes(3);
    expect(onTelemetry.mock.calls.map((c) => c[0]).sort()).toEqual(["logs", "metrics", "traces"]);
  });

  // ─── Reconnect path ──────────────────────────────────────────────

  it("kicks → reconnects → re-subscribes; generation bumps to 2; new snapshot resets tracker", async () => {
    host.setOnInitialize(() => INIT_RESULT);
    let subscribeFromSeq = 5;
    host.setOnRequest(async (req) => {
      if (req.method === "subscribe") {
        const result: SubscribeResult = {
          snapshot: makeSnapshot("ahp-session:/x", subscribeFromSeq),
        };
        subscribeFromSeq += 10;
        return { jsonrpc: "2.0", id: req.id, result };
      }
      if (req.method === "listSessions") {
        return { jsonrpc: "2.0", id: req.id, result: { items: [] } };
      }
      return { jsonrpc: "2.0", id: req.id, result: null };
    });
    const s = buildSupervisor();
    await s.open();
    const iter = s.subscribe("ahp-session:/x");
    const it = iter[Symbol.asyncIterator]();
    const first = (await it.next()).value;
    expect(first?.kind).toBe("snapshot");
    expect(first?.serverSeq).toBe(5);

    expect(s.generation()).toBe(1);
    host.kick();
    await waitForState(s, "open"); // wait for reconnect cycle

    const second = (await it.next()).value;
    expect(second?.kind).toBe("snapshot");
    expect(second?.serverSeq).toBe(15);
    expect(s.generation()).toBe(2);
  });

  // ─── close() cleanup ─────────────────────────────────────────────

  it("close() closes the iterable with an 'unavailable' tail and rejects further requests", async () => {
    host.setOnInitialize(() => INIT_RESULT);
    host.setOnRequest(async (req) => {
      if (req.method === "subscribe") {
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: { snapshot: makeSnapshot("ahp-session:/x", 0) } as SubscribeResult,
        };
      }
      if (req.method === "listSessions") {
        return { jsonrpc: "2.0", id: req.id, result: { items: [] } };
      }
      return { jsonrpc: "2.0", id: req.id, result: null };
    });
    const s = buildSupervisor();
    await s.open();
    const iter = s.subscribe("ahp-session:/x");
    const collected: SubscriptionMessage[] = [];
    const consumer = (async () => {
      for await (const ev of iter) {
        collected.push(ev);
      }
    })();
    await new Promise((r) => setTimeout(r, 30)); // let snapshot enqueue
    await s.close();
    await consumer;
    expect(collected.map((e) => e.kind)).toEqual(["snapshot", "unavailable"]);
    await expect(s.request("listSessions", { channel: "ahp-root://" })).rejects.toThrow();
    supervisor = undefined; // already closed
  });

  // ─── ClientId persistence ────────────────────────────────────────

  it("persists clientId across two supervisor lifecycles using the same ClientIdStore", async () => {
    host.setOnInitialize(() => INIT_RESULT);
    host.setOnRequest(async (req) => ({ jsonrpc: "2.0", id: req.id, result: { items: [] } }));
    const store = new InMemoryClientIdStore();
    const first = new HostSupervisor({
      host: {
        environmentId: ENV_ID,
        baseUrl: host.url,
        powerlineToken: host.powerlineToken,
      },
      clientIdStore: store,
    });
    await first.open();
    const firstClientId = host.connections[0]?.clientId;
    expect(firstClientId).toBeDefined();
    await first.close();

    const second = new HostSupervisor({
      host: {
        environmentId: ENV_ID,
        baseUrl: host.url,
        powerlineToken: host.powerlineToken,
      },
      clientIdStore: store,
    });
    await second.open();
    const secondClientId = host.connections[1]?.clientId;
    expect(secondClientId).toBe(firstClientId);
    await second.close();
    supervisor = undefined;
  });

  // ─── onStateChange ───────────────────────────────────────────────

  it("onStateChange fires for every transition; unsubscribe stops further fires", async () => {
    host.setOnInitialize(() => INIT_RESULT);
    host.setOnRequest(async (req) => ({ jsonrpc: "2.0", id: req.id, result: { items: [] } }));
    const s = buildSupervisor();
    const states: string[] = [];
    const unsub = s.onStateChange((state) => states.push(state));
    await s.open();
    expect(states).toContain("open");
    unsub();
    const before = states.length;
    await s.close();
    // After unsubscribe, no further states should be appended.
    expect(states.length).toBe(before);
  });

  // ─── Unused params alias to silence the strict-typedef rule ──────

  it("InitializeParams type is what the host receives", async () => {
    host.setOnInitialize((p: InitializeParams) => {
      expect(p.channel).toBe("ahp-root://");
      expect(p.clientId.length).toBeGreaterThan(0);
      return INIT_RESULT;
    });
    host.setOnRequest(async (req) => ({ jsonrpc: "2.0", id: req.id, result: { items: [] } }));
    const s = buildSupervisor();
    await s.open();
    // Touch SubscribeParams type so unused-import lints don't trip on a real signature reference.
    const params: SubscribeParams = { channel: "ahp-session:/x" };
    expect(params.channel).toBe("ahp-session:/x");
  });
});
