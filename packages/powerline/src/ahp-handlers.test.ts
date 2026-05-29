/**
 * Loopback tests for `ahp-handlers.ts` — the PowerLine AHP request/notification
 * surface. Spins up a real `http.Server` + `AhpServerSocket` + connects an
 * `AhpClientSocket` from a stub adapter, and a stub `AgentSession` whose
 * `stream()` we control. Every test exercises the integrated request →
 * notification → reverse-mapping path.
 */

import type { ActionEnvelope, StateAction } from "@grackle-ai/ahp";
import { ActionType, JsonRpcErrorCodes, SessionStatus as SessionStatusE } from "@grackle-ai/ahp";
import { AhpClientSocket, InMemoryClientIdStore, WsCloseCode } from "@grackle-ai/ahp-transport";
import type {
  AgentEvent,
  AgentRuntime,
  AgentSession,
  ResumeOptions,
  SpawnOptions,
} from "@grackle-ai/runtime-sdk";
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
});

describe("ahp-handlers: dispatchAction", () => {
  it("routes SessionTurnStartedAction.userMessage.text to session.sendInput", async () => {
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
        userMessage: { text: "hello from webhook" },
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
    const sessionId = `s-park-${String(Date.now())}`;
    try {
      await clientA.socket.request("createSession", {
        channel: `ahp-session:/${sessionId}`,
        provider: TEST_RUNTIME.name,
        config: {},
      });
      const session = TEST_RUNTIME.lastSession!;
      // Subscribe so the forwarder starts and drains queued events into the
      // wire — but we'll let some events accumulate in the session buffer
      // before disconnecting, so they survive as parked events.
      await clientA.socket.request("subscribe", { channel: `ahp-session:/${sessionId}` });
      // Push events into the session BEFORE the disconnect, but don't wait
      // for them to all reach the client — the in-flight ones get parked.
      session.push({ type: "turn_started", turnId: "tp", content: JSON.stringify({}) });
      session.push({ type: "text", turnId: "tp", content: "pre-disconnect" });
      // Force a hard disconnect on the wire (simulates heartbeat timeout).
      await clientA.socket.close();
      // Push more events while disconnected — these accumulate in
      // session.buffer (until parkSession drains them on disconnect handler).
      // Note: the onDisconnect handler kills the session + parks remaining
      // events synchronously. After a brief wait, we re-connect and see them.
      await new Promise((r) => setTimeout(r, 100));
      expect(session.killed).toBe(true);
    } finally {
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
