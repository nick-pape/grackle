/**
 * Contract tests for `GrpcHostTransport` (AHP HR8c).
 *
 * Verifies each method translates the typed AHP-shaped input into the right
 * gRPC RPC call against the wrapped `PowerLineClient` and (for streaming
 * methods) folds the response through the mapper to produce envelopes.
 */
import { describe, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { powerline } from "@grackle-ai/common";
import { ActionType } from "@grackle-ai/ahp";
import { GrpcHostTransport } from "./grpc-host-transport.js";
import type { PowerLineClient } from "./adapter.js";

/** Build a mock PowerLineClient with vi.fn() stubs for every RPC the transport touches. */
function makeMockClient(): {
  client: PowerLineClient;
  spawn: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  drainBufferedEvents: ReturnType<typeof vi.fn>;
  sendInput: ReturnType<typeof vi.fn>;
  authenticate: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  listSessions: ReturnType<typeof vi.fn>;
} {
  const spawn = vi.fn();
  const resume = vi.fn();
  const drainBufferedEvents = vi.fn();
  const sendInput = vi.fn().mockResolvedValue(create(powerline.EmptySchema, {}));
  const authenticate = vi.fn().mockResolvedValue(create(powerline.EmptySchema, {}));
  const kill = vi.fn().mockResolvedValue(create(powerline.EmptySchema, {}));
  const listSessions = vi.fn();
  const client = {
    spawn,
    resume,
    drainBufferedEvents,
    sendInput,
    authenticate,
    kill,
    listSessions,
  } as unknown as PowerLineClient;
  return {
    client,
    spawn,
    resume,
    drainBufferedEvents,
    sendInput,
    authenticate,
    kill,
    listSessions,
  };
}

/** Build an async iterable that yields a fixed list of AgentEvent messages. */
async function* eventStream(events: powerline.AgentEvent[]): AsyncIterable<powerline.AgentEvent> {
  for (const event of events) {
    yield event;
  }
}

describe("GrpcHostTransport.createSession", () => {
  it("calls client.spawn with a populated SpawnRequest and exposes the stream", async () => {
    const { client, spawn } = makeMockClient();
    spawn.mockReturnValue(eventStream([]));
    const transport = new GrpcHostTransport(client);

    const { sessionUri, stream } = transport.createSession({
      sessionId: "sess-1",
      runtime: "claude-code",
      prompt: "do the thing",
      model: "sonnet",
      maxTurns: 5,
      branch: "main",
      workingDirectory: "/workspace",
      systemContext: "ctx",
      workspaceId: "ws-1",
      taskId: "task-1",
      mcpServersJson: "[]",
      mcpUrl: "http://127.0.0.1:7435/mcp",
      mcpToken: "tok",
      useWorktrees: true,
    });

    expect(sessionUri).toBe("sess-1");
    expect(spawn).toHaveBeenCalledTimes(1);
    const spawnReq = spawn.mock.calls[0][0];
    expect(spawnReq.sessionId).toBe("sess-1");
    expect(spawnReq.runtime).toBe("claude-code");
    expect(spawnReq.taskId).toBe("task-1");
    expect(spawnReq.useWorktrees).toBe(true);

    // Stream is iterable (empty here) — drains without error.
    const collected: unknown[] = [];
    for await (const envelope of stream) {
      collected.push(envelope);
    }
    expect(collected).toEqual([]);
  });

  it("folds each AgentEvent into an envelope with mapped AHP actions", async () => {
    const { client, spawn } = makeMockClient();
    const turnStarted = create(powerline.AgentEventSchema, {
      sessionId: "s1",
      type: "turn_started",
      timestamp: "2026-01-01T00:00:00Z",
      content: JSON.stringify({ user_message: "hi" }),
      turnId: "t1",
    });
    spawn.mockReturnValue(eventStream([turnStarted]));
    const transport = new GrpcHostTransport(client);

    const { stream } = transport.createSession({
      sessionId: "s1",
      runtime: "claude-code",
      prompt: "",
      model: "",
      maxTurns: 0,
      branch: "",
      workingDirectory: "",
      systemContext: "",
      taskId: "",
      mcpServersJson: "",
      mcpUrl: "",
      mcpToken: "",
    });

    const envelopes: Array<{ event: { type: string }; actions: Array<{ type: string }> }> = [];
    for await (const envelope of stream) {
      envelopes.push(envelope);
    }
    expect(envelopes.length).toBe(1);
    expect(envelopes[0].event.type).toBe("turn_started");
    expect(envelopes[0].actions.length).toBe(1);
    expect(envelopes[0].actions[0].type).toBe(ActionType.SessionTurnStarted);
  });
});

describe("GrpcHostTransport.reanimate", () => {
  it("calls client.resume with a populated ResumeRequest and exposes the stream", async () => {
    const { client, resume } = makeMockClient();
    resume.mockReturnValue(eventStream([]));
    const transport = new GrpcHostTransport(client);

    const stream = transport.reanimate({
      sessionId: "sess-2",
      runtimeSessionId: "runtime-abc",
      runtime: "claude-code",
    });

    expect(resume).toHaveBeenCalledTimes(1);
    const resumeReq = resume.mock.calls[0][0];
    expect(resumeReq.sessionId).toBe("sess-2");
    expect(resumeReq.runtimeSessionId).toBe("runtime-abc");
    expect(resumeReq.runtime).toBe("claude-code");

    const collected: unknown[] = [];
    for await (const envelope of stream) {
      collected.push(envelope);
    }
    expect(collected).toEqual([]);
  });
});

describe("GrpcHostTransport.drainBuffered", () => {
  it("calls client.drainBufferedEvents and folds events into envelopes", async () => {
    const { client, drainBufferedEvents } = makeMockClient();
    const textEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-3",
      type: "text",
      content: "hello",
      turnId: "t1",
    });
    drainBufferedEvents.mockReturnValue(eventStream([textEvent]));
    const transport = new GrpcHostTransport(client);

    const stream = transport.drainBuffered("sess-3");
    const envelopes: unknown[] = [];
    for await (const envelope of stream) {
      envelopes.push(envelope);
    }

    expect(drainBufferedEvents).toHaveBeenCalledTimes(1);
    const drainReq = drainBufferedEvents.mock.calls[0][0];
    expect(drainReq.sessionId).toBe("sess-3");
    expect(envelopes.length).toBe(1);
  });
});

describe("GrpcHostTransport.dispatchInput", () => {
  it("calls client.sendInput with the message text", async () => {
    const { client, sendInput } = makeMockClient();
    const transport = new GrpcHostTransport(client);

    await transport.dispatchInput("sess-4", "hello from test");

    expect(sendInput).toHaveBeenCalledTimes(1);
    const inputReq = sendInput.mock.calls[0][0];
    expect(inputReq.sessionId).toBe("sess-4");
    expect(inputReq.text).toBe("hello from test");
  });
});

describe("GrpcHostTransport.authenticate", () => {
  it("calls client.authenticate with the provider and tokens", async () => {
    const { client, authenticate } = makeMockClient();
    const transport = new GrpcHostTransport(client);

    await transport.authenticate({
      provider: "claude-code",
      tokens: [
        {
          name: "ANTHROPIC_API_KEY",
          type: "env_var",
          envVar: "ANTHROPIC_API_KEY",
          value: "sk-...",
        },
        { name: "claude-cred", type: "file", filePath: "~/.claude/.credentials.json", value: "{}" },
      ],
    });

    expect(authenticate).toHaveBeenCalledTimes(1);
    const authReq = authenticate.mock.calls[0][0];
    expect(authReq.provider).toBe("claude-code");
    expect(authReq.tokens.length).toBe(2);
    expect(authReq.tokens[0].envVar).toBe("ANTHROPIC_API_KEY");
    expect(authReq.tokens[1].filePath).toBe("~/.claude/.credentials.json");
  });
});

describe("GrpcHostTransport.dispose", () => {
  it("calls client.kill with the session id and reason", async () => {
    const { client, kill } = makeMockClient();
    const transport = new GrpcHostTransport(client);

    await transport.dispose("sess-5", "completed");

    expect(kill).toHaveBeenCalledTimes(1);
    const killReq = kill.mock.calls[0][0];
    expect(killReq.id).toBe("sess-5");
    expect(killReq.reason).toBe("completed");
  });
});

describe("GrpcHostTransport.listSessions", () => {
  it("calls client.listSessions and maps the result", async () => {
    const { client, listSessions } = makeMockClient();
    listSessions.mockResolvedValue(
      create(powerline.SessionListSchema, {
        sessions: [
          create(powerline.SessionInfoSchema, {
            sessionId: "s1",
            runtime: "claude-code",
            status: "running",
          }),
        ],
      }),
    );
    const transport = new GrpcHostTransport(client);

    const result = await transport.listSessions();

    expect(listSessions).toHaveBeenCalledTimes(1);
    expect(result.length).toBe(1);
    expect(result[0]).toEqual({
      sessionId: "s1",
      runtime: "claude-code",
      status: "running",
    });
  });
});
