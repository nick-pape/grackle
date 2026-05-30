/**
 * Loopback tests for `ahp-handlers.ts` — the PowerLine AHP request/notification
 * surface. Spins up a real `http.Server` + `AhpServerSocket` + connects an
 * `AhpClientSocket` from a stub adapter, and a stub `AgentSession` whose
 * `stream()` we control. Every test exercises the integrated request →
 * notification → reverse-mapping path.
 */

import type {
  ActionEnvelope,
  ResourceListResult,
  ResourceReadResult,
  StateAction,
} from "@grackle-ai/ahp";
import {
  ActionType,
  AhpErrorCodes,
  ContentEncoding,
  JsonRpcErrorCodes,
  MessageKind,
  SessionStatus as SessionStatusE,
} from "@grackle-ai/ahp";
import { AhpClientSocket, InMemoryClientIdStore, WsCloseCode } from "@grackle-ai/ahp-transport";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AgentEvent,
  AgentRuntime,
  AgentSession,
  ResumeOptions,
  SpawnOptions,
} from "@grackle-ai/runtime-sdk";
import { worktreeDir } from "@grackle-ai/runtime-sdk";
import { SESSION_STATUS, type SessionStatus } from "@grackle-ai/common";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mountAhpServer } from "./ahp-handlers.js";
import { registerRuntime } from "./runtime-registry.js";
import { listAllSessions, parkSession, removeSession } from "./session-mgr.js";

// ─── Test helpers ─────────────────────────────────────────────

/**
 * Manual queue we can push events into from tests; `session.stream()` yields
 * them in order. Calling `endStream()` lets the generator finish.
 */
class StubSession implements AgentSession {
  public readonly id: string;
  public readonly runtimeName: string;
  public readonly runtimeSessionId: string;
  public status: SessionStatus = SESSION_STATUS.RUNNING;

  private readonly buffer: AgentEvent[] = [];
  private readonly waiters: Array<(e: AgentEvent | undefined) => void> = [];
  private closed: boolean = false;
  public lastInput: string | undefined;
  public killed: boolean = false;
  public killReason: string | undefined;
  /** Number of times `stream()` has been invoked (the contract is one call per session lifetime). */
  public streamCallCount: number = 0;

  public constructor(id: string, runtimeName: string, runtimeSessionId: string) {
    this.id = id;
    this.runtimeName = runtimeName;
    this.runtimeSessionId = runtimeSessionId;
  }

  public push(event: AgentEvent): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter(event);
    } else {
      this.buffer.push(event);
    }
  }

  public endStream(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()!(undefined);
    }
  }

  public async *stream(): AsyncIterable<AgentEvent> {
    this.streamCallCount++;
    while (true) {
      const head = this.buffer.shift();
      if (head !== undefined) {
        yield head;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<AgentEvent | undefined>((resolve) => {
        this.waiters.push(resolve);
      });
      if (next === undefined) return;
      yield next;
    }
  }

  public sendInput(text: string): void {
    this.lastInput = text;
  }

  public kill(reason?: string): void {
    this.killed = true;
    this.killReason = reason;
    this.endStream();
  }

  public drainBufferedEvents(): AgentEvent[] {
    const drained = this.buffer.splice(0);
    return drained;
  }
}

class StubRuntime implements AgentRuntime {
  public readonly name: string;
  public readonly spawnCalls: SpawnOptions[] = [];
  public readonly resumeCalls: ResumeOptions[] = [];
  public lastSession: StubSession | undefined;

  public constructor(name: string = "stub-test") {
    this.name = name;
  }

  public spawn(opts: SpawnOptions): AgentSession {
    this.spawnCalls.push(opts);
    const session = new StubSession(opts.sessionId, this.name, `rt-spawn-${opts.sessionId}`);
    this.lastSession = session;
    return session;
  }

  public resume(opts: ResumeOptions): AgentSession {
    this.resumeCalls.push(opts);
    const session = new StubSession(opts.sessionId, this.name, opts.runtimeSessionId);
    this.lastSession = session;
    return session;
  }
}

interface Loopback {
  port: number;
  server: Server;
  ahp: ReturnType<typeof mountAhpServer>;
  cleanup(): Promise<void>;
}

async function spinUpLoopback(): Promise<Loopback> {
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const ahp = mountAhpServer({ server, powerlineToken: "test-token" });
  return {
    port,
    server,
    ahp,
    async cleanup() {
      await ahp.close().catch(() => {});
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

interface Client {
  socket: AhpClientSocket;
  received: ActionEnvelope[];
  cleanup(): Promise<void>;
}

async function openClient(port: number, keyOverride?: string): Promise<Client> {
  const received: ActionEnvelope[] = [];
  const socket = new AhpClientSocket({
    url: `ws://127.0.0.1:${String(port)}/ahp`,
    powerlineToken: "test-token",
    clientIdStore: new InMemoryClientIdStore(),
    clientIdKey: keyOverride ?? `client-${String(Math.floor(Math.random() * 1_000_000))}`,
    onNotification: (n) => {
      if (n.method === "action") {
        received.push(n.params as ActionEnvelope);
      }
    },
  });
  await socket.open();
  return {
    socket,
    received,
    async cleanup() {
      await socket.close().catch(() => {});
    },
  };
}

/** Poll until `received` reaches at least N entries or `timeoutMs` elapses. */
async function waitForCount(
  arr: unknown[],
  count: number,
  timeoutMs: number = 1500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (arr.length < count) {
    if (Date.now() > deadline) {
      throw new Error(`waitForCount timed out at ${String(arr.length)}/${String(count)}`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const TEST_RUNTIME = new StubRuntime("ahp-handlers-test");

// Register once; vi.beforeEach clears the spawn/resume call history.
registerRuntime(TEST_RUNTIME);

beforeEach(() => {
  TEST_RUNTIME.spawnCalls.length = 0;
  TEST_RUNTIME.resumeCalls.length = 0;
  TEST_RUNTIME.lastSession = undefined;
  // Clean any sessions left over from prior tests.
  for (const s of listAllSessions()) {
    removeSession(s.id);
  }
});

// ─── Tests ────────────────────────────────────────────────────

describe("ahp-handlers: initialize", () => {
  it("returns the canned InitializeResult on first connect", async () => {
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      // The state is "open" only after a successful initialize handshake.
      expect(client.socket.state).toBe("open");
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });
});

describe("ahp-handlers: createSession", () => {
  it("dispatches spawn to the registered runtime when no resumeFromRuntimeSessionId", async () => {
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      const sessionId = `s-spawn-${String(Date.now())}`;
      await client.socket.request("createSession", {
        channel: `ahp-session:/${sessionId}`,
        provider: TEST_RUNTIME.name,
        config: { taskId: "task-1", mcpServersJson: "" },
      });
      expect(TEST_RUNTIME.spawnCalls).toHaveLength(1);
      expect(TEST_RUNTIME.spawnCalls[0]?.sessionId).toBe(sessionId);
      expect(TEST_RUNTIME.resumeCalls).toHaveLength(0);
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });

  it("dispatches resume when config.resumeFromRuntimeSessionId is set", async () => {
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      const sessionId = `s-resume-${String(Date.now())}`;
      await client.socket.request("createSession", {
        channel: `ahp-session:/${sessionId}`,
        provider: TEST_RUNTIME.name,
        config: { resumeFromRuntimeSessionId: "rt-prior", taskId: "task-2", mcpServersJson: "" },
      });
      expect(TEST_RUNTIME.resumeCalls).toHaveLength(1);
      expect(TEST_RUNTIME.resumeCalls[0]?.runtimeSessionId).toBe("rt-prior");
      expect(TEST_RUNTIME.spawnCalls).toHaveLength(0);
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });

  it("rejects the bare `ahp-session:/` channel with an empty sessionId (HR8d)", async () => {
    // Without the empty-id guard in sessionIdFromChannel, this would slice to
    // sessionId="" and proceed to register it, creating registry collisions.
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      await expect(
        client.socket.request("createSession", {
          channel: `ahp-session:/`,
          provider: TEST_RUNTIME.name,
          config: {},
        }),
      ).rejects.toMatchObject({
        code: JsonRpcErrorCodes.InvalidParams,
      });
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });

  it("returns a JSON-RPC InvalidParams error when the provider is unknown", async () => {
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      const sessionId = `s-unknown-${String(Date.now())}`;
      await expect(
        client.socket.request("createSession", {
          channel: `ahp-session:/${sessionId}`,
          provider: "not-a-real-runtime",
          config: {},
        }),
      ).rejects.toMatchObject({
        code: JsonRpcErrorCodes.InvalidParams,
      });
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });

  it("returns a JSON-RPC InvalidRequest error when the sessionId already exists", async () => {
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      const sessionId = `s-dup-${String(Date.now())}`;
      await client.socket.request("createSession", {
        channel: `ahp-session:/${sessionId}`,
        provider: TEST_RUNTIME.name,
        config: {},
      });
      await expect(
        client.socket.request("createSession", {
          channel: `ahp-session:/${sessionId}`,
          provider: TEST_RUNTIME.name,
          config: {},
        }),
      ).rejects.toMatchObject({
        code: JsonRpcErrorCodes.InvalidRequest,
      });
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });
});

describe("ahp-handlers: subscribe", () => {
  it("forwards live AgentEvents as `action` notifications", async () => {
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      const sessionId = `s-live-${String(Date.now())}`;
      await client.socket.request("createSession", {
        channel: `ahp-session:/${sessionId}`,
        provider: TEST_RUNTIME.name,
        config: {},
      });
      const session = TEST_RUNTIME.lastSession!;
      // Subscribe → starts the forwarder.
      await client.socket.request("subscribe", { channel: `ahp-session:/${sessionId}` });
      // Push a turn_started → text → turn_complete sequence.
      session.push({ type: "turn_started", turnId: "t1", content: JSON.stringify({}) });
      session.push({ type: "text", turnId: "t1", content: "hi" });
      session.push({ type: "turn_complete", turnId: "t1" });
      await waitForCount(client.received, 3);
      const types = client.received.map((env) => env.action.type);
      expect(types[0]).toBe(ActionType.SessionTurnStarted);
      expect(types[1]).toBe(ActionType.SessionResponsePart);
      expect(types[2]).toBe(ActionType.SessionTurnComplete);
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });

  it("replays parked events for a session before live events on subscribe", async () => {
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      const sessionId = `s-parked-${String(Date.now())}`;
      // Pre-park some events for a session ID the client will subscribe to.
      parkSession(sessionId, [
        { type: "turn_started", turnId: "tp", content: JSON.stringify({}) } as AgentEvent,
        { type: "text", turnId: "tp", content: "parked-1" } as AgentEvent,
        { type: "text", turnId: "tp", content: "parked-2" } as AgentEvent,
      ]);
      // Subscribe through the wire (no active session — just parked events).
      await client.socket.request("subscribe", { channel: `ahp-session:/${sessionId}` });
      await waitForCount(client.received, 3);
      expect(client.received.map((e) => e.action.type)).toEqual([
        ActionType.SessionTurnStarted,
        ActionType.SessionResponsePart,
        ActionType.SessionResponsePart,
      ]);
      // Verify content fidelity for parked text events.
      const parts = client.received.filter((e) => e.action.type === ActionType.SessionResponsePart);
      const contents = parts.map((p) => {
        const act = p.action as { part: { content: string } };
        return act.part.content;
      });
      expect(contents).toEqual(["parked-1", "parked-2"]);
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });

  it("[orphan rescue] wraps an orphan text event in a complete synthetic turn", async () => {
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      const sessionId = `s-orphan-${String(Date.now())}`;
      await client.socket.request("createSession", {
        channel: `ahp-session:/${sessionId}`,
        provider: TEST_RUNTIME.name,
        config: {},
      });
      const session = TEST_RUNTIME.lastSession!;
      await client.socket.request("subscribe", { channel: `ahp-session:/${sessionId}` });
      // Emit text with NO turnId — under gRPC this flowed; under bare AHP
      // mapper it'd be dropped. The orphan-rescue path wraps the event in
      // a complete synthetic turn so the consumer's turn-grouping renders
      // it without hanging on an unterminated turn.
      session.push({ type: "text", content: "Ready for input..." });
      await waitForCount(client.received, 3);
      expect(client.received[0]?.action.type).toBe(ActionType.SessionTurnStarted);
      expect(client.received[1]?.action.type).toBe(ActionType.SessionResponsePart);
      expect(client.received[2]?.action.type).toBe(ActionType.SessionTurnComplete);
      const synth = client.received[0]!.action as { turnId: string };
      expect(synth.turnId.startsWith("turn-orphan-")).toBe(true);
      const part = client.received[1]!.action as { turnId: string; part: { content: string } };
      expect(part.turnId).toBe(synth.turnId);
      expect(part.part.content).toBe("Ready for input...");
      const completed = client.received[2]!.action as { turnId: string };
      expect(completed.turnId).toBe(synth.turnId);
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });

  it("invokes session.stream() exactly once across many resubscribes on the same channel", async () => {
    // Regression for the HR8d listener-leak: PowerLine's subscribe handler
    // used to call session.stream() once per subscribe, which (a) parked a new
    // EventEmitter "input" listener on stub sessions and (b) re-entered
    // BaseAgentSession.runSession() on production runtimes. The contract is:
    // session.stream() is the session's *driver*; PowerLine drives it exactly
    // once per session lifetime, no matter how many subscribes arrive on the
    // same channel.
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      const sessionId = `s-stream-once-${String(Date.now())}`;
      await client.socket.request("createSession", {
        channel: `ahp-session:/${sessionId}`,
        provider: TEST_RUNTIME.name,
        config: {},
      });
      const session = TEST_RUNTIME.lastSession!;
      // 12 subscribes — well past Node's default MaxListeners of 10. Pre-fix,
      // this is where MaxListenersExceededWarning would fire on a real stub.
      for (let i = 0; i < 12; i++) {
        await client.socket.request("subscribe", { channel: `ahp-session:/${sessionId}` });
      }
      expect(session.streamCallCount).toBe(1);
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });

  it("a rapid resubscribe that cancels its predecessor still gets the first-subscribe replay", async () => {
    // Race regression: handleSubscribe runs synchronously and `queueMicrotask`s
    // a runForwarder for each subscribe. If a second subscribe arrives before
    // the first's microtask runs, the first forwarder is cancelled. The
    // *second* one is then the real first subscriber — it must replay from
    // the buffer start, not start at the current tail. Pre-fix the cancelled
    // forwarder still ran far enough to bump `totalForwardersAttached`, and
    // the second forwarder mis-detected itself as a resubscriber.
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      const sessionId = `s-rapid-${String(Date.now())}`;
      await client.socket.request("createSession", {
        channel: `ahp-session:/${sessionId}`,
        provider: TEST_RUNTIME.name,
        config: {},
      });
      const session = TEST_RUNTIME.lastSession!;
      // Push setup events the first real subscriber must see.
      session.push({ type: "turn_started", turnId: "t1", content: JSON.stringify({}) });
      session.push({ type: "text", turnId: "t1", content: "setup" });
      // Fire two subscribes back-to-back. With `await` they're sequential on
      // the wire, but the server-side runForwarder for each is queued via
      // microtask so the second wins the cancellation race.
      await client.socket.request("subscribe", { channel: `ahp-session:/${sessionId}` });
      await client.socket.request("subscribe", { channel: `ahp-session:/${sessionId}` });
      await waitForCount(client.received, 2);
      // The second subscribe should have seen turn_started + text (both
      // events from before its arrival), not just "future events only."
      expect(client.received.map((env) => env.action.type)).toEqual([
        ActionType.SessionTurnStarted,
        ActionType.SessionResponsePart,
      ]);
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });

  it("a resubscribe on a live session sees only events that arrive after the resubscribe", async () => {
    // Codifies the new live-tail semantic. The first subscriber drained A/B/C;
    // a fresh subscribe should pick up at the current pump tail, not replay
    // the history. "What did I miss while disconnected" is the parked-replay
    // path's responsibility (covered by the existing parked-replay test).
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      const sessionId = `s-late-${String(Date.now())}`;
      await client.socket.request("createSession", {
        channel: `ahp-session:/${sessionId}`,
        provider: TEST_RUNTIME.name,
        config: {},
      });
      const session = TEST_RUNTIME.lastSession!;
      await client.socket.request("subscribe", { channel: `ahp-session:/${sessionId}` });
      session.push({ type: "turn_started", turnId: "t1", content: JSON.stringify({}) });
      session.push({ type: "text", turnId: "t1", content: "A" });
      session.push({ type: "text", turnId: "t1", content: "B" });
      await waitForCount(client.received, 3);
      const sawBeforeResubscribe = client.received.length;
      // Resubscribe — should NOT replay A/B from the top.
      await client.socket.request("subscribe", { channel: `ahp-session:/${sessionId}` });
      session.push({ type: "text", turnId: "t1", content: "C" });
      await waitForCount(client.received, sawBeforeResubscribe + 1);
      const newlyReceived = client.received
        .slice(sawBeforeResubscribe)
        .map((env) => env.action) as Array<{ part?: { content?: string } }>;
      expect(newlyReceived).toHaveLength(1);
      expect(newlyReceived[0]?.part?.content).toBe("C");
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });

  it("[status rescue] forwards a terminal `killed` status as SessionMetaChanged (#1356)", async () => {
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      const sessionId = `s-killstatus-${String(Date.now())}`;
      await client.socket.request("createSession", {
        channel: `ahp-session:/${sessionId}`,
        provider: TEST_RUNTIME.name,
        config: {},
      });
      const session = TEST_RUNTIME.lastSession!;
      await client.socket.request("subscribe", { channel: `ahp-session:/${sessionId}` });
      // A runtime emits `killed` on SIGTERM/abort. Before #1356 the mapper
      // dropped it; now it must be rescued so the UI sees the terminal state.
      session.push({ type: "status", content: "killed" });
      await waitForCount(client.received, 1);
      const action = client.received[0]!.action as { type: unknown; _meta?: { status?: string } };
      expect(action.type).toBe(ActionType.SessionMetaChanged);
      expect(action._meta?.status).toBe("killed");
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });
});

describe("ahp-handlers: dispatchAction", () => {
  it("routes SessionTurnStartedAction.message.text to session.sendInput", async () => {
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      const sessionId = `s-dispatch-${String(Date.now())}`;
      await client.socket.request("createSession", {
        channel: `ahp-session:/${sessionId}`,
        provider: TEST_RUNTIME.name,
        config: {},
      });
      const session = TEST_RUNTIME.lastSession!;
      const action: StateAction = {
        type: ActionType.SessionTurnStarted,
        turnId: "turn-input",
        message: { text: "hello from webhook", origin: { kind: MessageKind.User } },
      };
      client.socket.notify("dispatchAction", {
        channel: `ahp-session:/${sessionId}`,
        clientSeq: 1,
        action,
      });
      // Wait for the notification to traverse the wire + handler.
      const deadline = Date.now() + 500;
      while (session.lastInput === undefined && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(session.lastInput).toBe("hello from webhook");
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });
});

describe("ahp-handlers: disposeSession", () => {
  it("kills the session and removes it from the registry", async () => {
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      const sessionId = `s-dispose-${String(Date.now())}`;
      await client.socket.request("createSession", {
        channel: `ahp-session:/${sessionId}`,
        provider: TEST_RUNTIME.name,
        config: {},
      });
      const session = TEST_RUNTIME.lastSession!;
      expect(listAllSessions().some((s) => s.id === sessionId)).toBe(true);
      await client.socket.request("disposeSession", { channel: `ahp-session:/${sessionId}` });
      expect(session.killed).toBe(true);
      expect(listAllSessions().some((s) => s.id === sessionId)).toBe(false);
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });

  it("synthesizes a terminal `killed` status as the last wire action (#1356)", async () => {
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      const sessionId = `s-dispose-killed-${String(Date.now())}`;
      await client.socket.request("createSession", {
        channel: `ahp-session:/${sessionId}`,
        provider: TEST_RUNTIME.name,
        config: {},
      });
      // Subscribe so a forwarder exists for the synthesized action to ride on.
      await client.socket.request("subscribe", { channel: `ahp-session:/${sessionId}` });
      await client.socket.request("disposeSession", { channel: `ahp-session:/${sessionId}` });
      await waitForCount(client.received, 1);
      // A `killed` SessionMetaChanged must be present, and the final action the
      // consumer sees must be terminal (never a trailing `waiting_input`).
      const killedMeta = client.received.find((e) => {
        const a = e.action as { type: unknown; _meta?: { status?: string } };
        return a.type === ActionType.SessionMetaChanged && a._meta?.status === "killed";
      });
      expect(killedMeta).toBeDefined();
      const last = client.received.at(-1)!.action as { type: unknown; _meta?: { status?: string } };
      expect(last.type).toBe(ActionType.SessionMetaChanged);
      expect(last._meta?.status).toBe("killed");
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });
});

describe("ahp-handlers: listSessions", () => {
  it("returns an items array shaped as SessionSummary", async () => {
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      const sessionId = `s-list-${String(Date.now())}`;
      await client.socket.request("createSession", {
        channel: `ahp-session:/${sessionId}`,
        provider: TEST_RUNTIME.name,
        config: {},
      });
      const result = (await client.socket.request("listSessions", {
        channel: "ahp-root://",
      })) as { items: Array<{ resource: string; provider: string; status: number }> };
      const found = result.items.find((s) => s.resource === `ahp-session:/${sessionId}`);
      expect(found).toBeDefined();
      expect(found?.provider).toBe(TEST_RUNTIME.name);
      // Default running status maps to SessionStatusE.InProgress.
      expect(found?.status).toBe(SessionStatusE.InProgress);
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });
});

describe("ahp-handlers: onDisconnect", () => {
  it("kills + parks each session owned by a disconnecting client; next subscribe replays them", async () => {
    const lb = await spinUpLoopback();
    const clientA = await openClient(lb.port, "client-A");
    let clientB: Client | undefined;
    const sessionId = `s-park-${String(Date.now())}`;
    try {
      await clientA.socket.request("createSession", {
        channel: `ahp-session:/${sessionId}`,
        provider: TEST_RUNTIME.name,
        config: {},
      });
      const session = TEST_RUNTIME.lastSession!;
      // Deliberately do NOT subscribe — the session pump still drains events
      // into pump.buffer regardless of subscribers. With no forwarder
      // delivering anything to the wire, `onDisconnect` parks the full
      // buffer (fromPos defaults to 0). This makes the park-the-tail path
      // deterministically testable without racing against wire delivery.
      session.push({ type: "turn_started", turnId: "tp", content: JSON.stringify({}) });
      session.push({ type: "text", turnId: "tp", content: "park-1" });
      session.push({ type: "text", turnId: "tp", content: "park-2" });
      // Yield once so the pump's microtasks drain stub.buffer into pump.buffer
      // before the disconnect handler runs.
      await new Promise((r) => setTimeout(r, 20));
      await clientA.socket.close();
      await new Promise((r) => setTimeout(r, 50));
      expect(session.killed).toBe(true);

      // A fresh client subscribing to the same channel should receive the
      // parked tail (turn_started + 2 text parts) as the replay.
      clientB = await openClient(lb.port, "client-B");
      await clientB.socket.request("subscribe", { channel: `ahp-session:/${sessionId}` });
      await waitForCount(clientB.received, 3);
      const types = clientB.received.map((env) => env.action.type);
      expect(types).toEqual([
        ActionType.SessionTurnStarted,
        ActionType.SessionResponsePart,
        ActionType.SessionResponsePart,
      ]);
      const contents = clientB.received
        .filter((e) => e.action.type === ActionType.SessionResponsePart)
        .map((e) => (e.action as { part: { content: string } }).part.content);
      expect(contents).toEqual(["park-1", "park-2"]);
    } finally {
      await clientB?.cleanup();
      await clientA.cleanup();
      await lb.cleanup();
    }
  });
});

describe("ahp-handlers: authenticate", () => {
  it("parses a grackle://provider/{p}/{n} resource + JSON token and calls writeTokens", async () => {
    // We intercept writeTokens via a vi.spyOn on the module surface so we
    // don't have to mount a real file-write.
    const tokenWriterModule: typeof import("./token-writer.js") = await import("./token-writer.js");
    const spy = vi.spyOn(tokenWriterModule, "writeTokens").mockResolvedValue(undefined);
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      await client.socket.request("authenticate", {
        channel: "ahp-root://",
        resource: "grackle://provider/claude-code/api-key",
        token: JSON.stringify({ type: "env_var", envVar: "ANTHROPIC_KEY", value: "sk-test" }),
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const call = spy.mock.calls[0]![0];
      expect(call[0]?.name).toBe("api-key");
      expect(call[0]?.type).toBe("env_var");
      expect(call[0]?.envVar).toBe("ANTHROPIC_KEY");
      expect(call[0]?.value).toBe("sk-test");
    } finally {
      spy.mockRestore();
      await client.cleanup();
      await lb.cleanup();
    }
  });

  it("rejects a non-grackle resource scheme with an InvalidParams JSON-RPC error", async () => {
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      await expect(
        client.socket.request("authenticate", {
          channel: "ahp-root://",
          resource: "https://example.com/oauth",
          token: "bearer-token",
        }),
      ).rejects.toMatchObject({
        code: JsonRpcErrorCodes.InvalidParams,
      });
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });
});

describe("ahp-handlers: heartbeat / WsCloseCode constants", () => {
  it("exposes a usable WsCloseCode value (sanity check)", () => {
    // Touches the imported constant so it stays referenced; the real
    // heartbeat path is verified by @grackle-ai/ahp-transport's own tests.
    expect(WsCloseCode.HeartbeatTimeout).toBe(4001);
  });
});

// ─── Production-StubSession integration (defensive-depth) ─────
//
// The tests above use the in-file mock StubSession (a plain queue + waiters).
// The real StubSession in `./runtimes/stub.ts` is what CI runs and what
// originally tripped MaxListenersExceededWarning — its `EventEmitter`-backed
// `waitForInput()` was the leaking party. These tests use that production
// session so any regression that re-introduces listener accumulation, or
// that loses early events under a fast createSession+subscribe pairing, is
// caught locally without waiting for the e2e suite to find it.

describe("ahp-handlers: production-StubSession defensive-depth", () => {
  it("[regression] 12 subscribes on a real StubSession scenario emit no MaxListenersExceededWarning", async () => {
    // Mirrors the failure pattern from publish-CI run 26618127961: the
    // recovery flow re-attaches to the same session many times in quick
    // succession; if any subscribe re-enters `session.stream()` it parks a
    // new `EventEmitter.once("input", …)` listener on the per-session
    // emitter, and after 11 the runtime emits a process warning. Rush's
    // e2e operation treats stderr warnings as warnings-as-errors and the
    // publish job fails. This test fires the same pattern and asserts the
    // listener count stays bounded.
    const { StubRuntime: ProdStubRuntime } = await import("./runtimes/stub.js");
    const realStub = new ProdStubRuntime();
    registerRuntime(realStub);

    const warnings: Error[] = [];
    const onWarning = (w: Error): void => {
      warnings.push(w);
    };
    process.on("warning", onWarning);

    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      const sessionId = `s-prod-stub-${String(Date.now())}`;
      // Scenario that emits one text event then idles (so the session parks
      // on `StubSession.waitForInput()` — the line that registers the
      // emitter listener that originally leaked).
      const scenario = JSON.stringify({
        steps: [{ emit: "text", content: "hello" }, { idle: true }],
      });
      await client.socket.request("createSession", {
        channel: `ahp-session:/${sessionId}`,
        provider: realStub.name,
        config: { prompt: scenario },
      });
      // 12 subscribes — well past Node's default MaxListeners of 10. With
      // the pump-driven design, `session.stream()` should be invoked
      // exactly once and no new `"input"` listeners should accumulate.
      for (let i = 0; i < 12; i++) {
        await client.socket.request("subscribe", { channel: `ahp-session:/${sessionId}` });
      }
      // Settle pending microtasks so any process warnings emitted as
      // a side-effect of subscribe complete delivery have a chance to fire.
      await new Promise((r) => setTimeout(r, 50));

      const maxListenerWarnings = warnings.filter((w) => w.name === "MaxListenersExceededWarning");
      expect(maxListenerWarnings).toEqual([]);
    } finally {
      process.off("warning", onWarning);
      await client.cleanup();
      await lb.cleanup();
    }
  });

  it("[regression] a fast-completing scenario that races subscribe still delivers turn_started + text on the wire", async () => {
    // The sync-pipe-idle.spec.ts:106 failure shape: a stub child runs the
    // scenario to completion *between* the server's createSession reply and
    // its follow-up subscribe over the wire. Pre-fix, the pump removed the
    // session from the registry in its `finally`, the still-arriving
    // subscribe got "Unknown session channel," and surfaceErrorAndClose
    // injected a synthetic `status: failed`. This test runs the smallest
    // version of that race directly against the production StubSession.
    const { StubRuntime: ProdStubRuntime } = await import("./runtimes/stub.js");
    const realStub = new ProdStubRuntime();
    registerRuntime(realStub);

    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      const sessionId = `s-fast-${String(Date.now())}`;
      // No idle step → scenario runs to completion immediately on the pump.
      const scenario = JSON.stringify({
        steps: [{ emit: "text", content: "Done!" }],
      });
      await client.socket.request("createSession", {
        channel: `ahp-session:/${sessionId}`,
        provider: realStub.name,
        config: { prompt: scenario },
      });
      // Give the pump a tick to drain the entire scenario before we
      // subscribe — this is the worst-case for the race the bug fixed.
      await new Promise((r) => setTimeout(r, 50));
      await client.socket.request("subscribe", { channel: `ahp-session:/${sessionId}` });
      // After subscribe, the first-forwarder replay should deliver the
      // setup events (system, runtime_session_id) AND the text event AND
      // the terminal status. We assert specifically that turn_started
      // (synthesized via orphan-rescue on the text event) and the
      // SessionResponsePart with "Done!" land on the wire — the failure
      // mode pre-fix was "Child session failed." because nothing landed.
      await waitForCount(client.received, 2, 3000);
      const types = client.received.map((env) => env.action.type);
      expect(types).toContain(ActionType.SessionTurnStarted);
      expect(types).toContain(ActionType.SessionResponsePart);
      // And, critically, NO SessionError action — the wire delivered the
      // real terminal status, not the synthetic "failed."
      const errors = client.received.filter((env) => env.action.type === ActionType.SessionError);
      expect(errors).toEqual([]);
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });
});

// ─── resources: read / list / watch ───────────────────────────

/** Extract the JSON-RPC error `code` from a rejected `request()` promise. */
async function expectRequestErrorCode(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (typeof code === "number") {
      return code;
    }
    throw new Error(`Expected a JSON-RPC error with numeric code, got: ${String(err)}`);
  }
  throw new Error("Expected request() to reject");
}

describe("resourceRead / resourceList", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "grackle-ahp-res-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  /** Create a session whose working directory is `workdir`, populating allowedRoots. */
  async function createSessionInWorkdir(client: Client, sessionId: string): Promise<void> {
    await client.socket.request("createSession", {
      channel: `ahp-session:/${sessionId}`,
      provider: TEST_RUNTIME.name,
      config: { workingDirectory: workdir },
    });
  }

  it("reads a file under the session working directory", async () => {
    await writeFile(join(workdir, "plan.md"), "# Plan", "utf-8");
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      await createSessionInWorkdir(client, "res-read-1");
      const result = (await client.socket.request("resourceRead", {
        channel: "ahp-root://",
        uri: pathToFileURL(join(workdir, "plan.md")).href,
      })) as ResourceReadResult;
      expect(result.encoding).toBe(ContentEncoding.Utf8);
      expect(result.contentType).toBe("text/markdown");
      expect(result.data).toBe("# Plan");
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });

  it("includes the sibling worktree root when a branch is set and useWorktrees is omitted", async () => {
    // BaseAgentSession defaults useWorktrees to true, so a session created with a
    // branch but no explicit useWorktrees edits in the sibling worktree dir; the
    // sandbox must therefore include that path, not just the working directory.
    const branch = "feature/x";
    const wt = worktreeDir(workdir, branch);
    await mkdir(wt, { recursive: true });
    await writeFile(join(wt, "doc.md"), "# WT", "utf-8");
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      await client.socket.request("createSession", {
        channel: "ahp-session:/res-wt-1",
        provider: TEST_RUNTIME.name,
        config: { workingDirectory: workdir, branch },
      });
      const result = (await client.socket.request("resourceRead", {
        channel: "ahp-root://",
        uri: pathToFileURL(join(wt, "doc.md")).href,
      })) as ResourceReadResult;
      expect(result.data).toBe("# WT");
    } finally {
      await rm(wt, { recursive: true, force: true });
      await client.cleanup();
      await lb.cleanup();
    }
  });

  it("lists entries under the session working directory", async () => {
    await writeFile(join(workdir, "a.txt"), "x", "utf-8");
    await mkdir(join(workdir, "sub"));
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      await createSessionInWorkdir(client, "res-list-1");
      const result = (await client.socket.request("resourceList", {
        channel: "ahp-root://",
        uri: pathToFileURL(workdir).href,
      })) as ResourceListResult;
      const byName = new Map(result.entries.map((e) => [e.name, e.type]));
      expect(byName.get("a.txt")).toBe("file");
      expect(byName.get("sub")).toBe("directory");
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });

  it("rejects a read outside the allowed roots with PermissionDenied", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "grackle-ahp-out-"));
    await writeFile(join(elsewhere, "secret.txt"), "nope", "utf-8");
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      await createSessionInWorkdir(client, "res-deny-1");
      const code = await expectRequestErrorCode(
        client.socket.request("resourceRead", {
          channel: "ahp-root://",
          uri: pathToFileURL(join(elsewhere, "secret.txt")).href,
        }),
      );
      expect(code).toBe(AhpErrorCodes.PermissionDenied);
    } finally {
      await client.cleanup();
      await lb.cleanup();
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it("rejects a read on a connection with no sessions (no roots)", async () => {
    await writeFile(join(workdir, "a.txt"), "x", "utf-8");
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      const code = await expectRequestErrorCode(
        client.socket.request("resourceRead", {
          channel: "ahp-root://",
          uri: pathToFileURL(join(workdir, "a.txt")).href,
        }),
      );
      expect(code).toBe(AhpErrorCodes.PermissionDenied);
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });

  it("returns NotFound for a missing file", async () => {
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      await createSessionInWorkdir(client, "res-missing-1");
      const code = await expectRequestErrorCode(
        client.socket.request("resourceRead", {
          channel: "ahp-root://",
          uri: pathToFileURL(join(workdir, "nope.txt")).href,
        }),
      );
      expect(code).toBe(AhpErrorCodes.NotFound);
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  });
});

describe("createResourceWatch", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "grackle-ahp-watch-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it("streams a resourceWatch/changed action when a file changes", async () => {
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      await client.socket.request("createSession", {
        channel: "ahp-session:/watch-1",
        provider: TEST_RUNTIME.name,
        config: { workingDirectory: workdir },
      });
      const { channel } = (await client.socket.request("createResourceWatch", {
        channel: "ahp-root://",
        uri: pathToFileURL(workdir).href,
      })) as { channel: string };
      expect(channel.startsWith("ahp-resource-watch:/")).toBe(true);
      await client.socket.request("subscribe", { channel });
      // Let chokidar's initial scan settle before mutating.
      await new Promise((r) => setTimeout(r, 400));
      await writeFile(join(workdir, "plan.md"), "# Plan", "utf-8");

      const deadline = Date.now() + 4000;
      let batch: ActionEnvelope | undefined;
      while (batch === undefined && Date.now() < deadline) {
        batch = client.received.find((e) => e.channel === channel);
        if (batch === undefined) {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      expect(batch).toBeDefined();
      const action = batch!.action as {
        type: string;
        changes: { items: Array<{ uri: string; type: string }> };
      };
      expect(action.type).toBe(ActionType.ResourceWatchChanged);
      expect(action.changes.items.length).toBeGreaterThan(0);
      expect(action.changes.items.some((c) => c.uri.endsWith("plan.md"))).toBe(true);
    } finally {
      await client.cleanup();
      await lb.cleanup();
    }
  }, 10_000);

  it("rejects createResourceWatch outside the allowed roots", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "grackle-ahp-watchout-"));
    const lb = await spinUpLoopback();
    const client = await openClient(lb.port);
    try {
      await client.socket.request("createSession", {
        channel: "ahp-session:/watch-deny-1",
        provider: TEST_RUNTIME.name,
        config: { workingDirectory: workdir },
      });
      const code = await expectRequestErrorCode(
        client.socket.request("createResourceWatch", {
          channel: "ahp-root://",
          uri: pathToFileURL(elsewhere).href,
        }),
      );
      expect(code).toBe(AhpErrorCodes.PermissionDenied);
    } finally {
      await client.cleanup();
      await lb.cleanup();
      await rm(elsewhere, { recursive: true, force: true });
    }
  });
});
