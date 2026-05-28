/**
 * Contract tests for {@link AhpHostTransport}.
 *
 * Mirrors the 7 test suites from `grpc-host-transport.test.ts` (createSession,
 * reanimate, dispatchInput, authenticate, dispose, listSessions, plus the
 * notification-routing path that's specific to AHP).
 *
 * Uses a stub `AhpClientSocket` that records outbound requests/notifications
 * and replays inbound notifications synchronously — no real network.
 */

import {
  ActionType,
  AuthRequiredReason,
  ResponsePartKind,
  SessionStatus,
  type AhpNotification,
  type AuthenticateResult,
  type ListSessionsResult,
  type SessionSummary,
  type StateAction,
  type SubscribeResult,
} from "@grackle-ai/ahp";
import type { AhpClientSocket } from "@grackle-ai/ahp-transport";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AhpHostTransport, bindNotificationHandler } from "./ahp-host-transport.js";
import type {
  AuthenticateParams,
  CreateSessionParams,
  ReanimateParams,
  ServerActionEnvelope,
} from "./host-transport.js";

interface RecordedRequest {
  method: string;
  params: unknown;
}

interface RecordedNotify {
  method: string;
  params: unknown;
}

/**
 * Test double for {@link AhpClientSocket}. Records every request/notify call,
 * lets the test program responses, and lets the test push inbound
 * notifications through the bound handler.
 */
class StubAhpClientSocket {
  public readonly recordedRequests: RecordedRequest[] = [];
  public readonly recordedNotifies: RecordedNotify[] = [];
  public requestResponder: (method: string, params: unknown) => unknown = () => null;
  private notificationHandler: ((n: AhpNotification) => void) | undefined;

  public bindHandler(handler: (n: AhpNotification) => void): void {
    this.notificationHandler = handler;
  }

  public async request(method: string, params: unknown): Promise<unknown> {
    this.recordedRequests.push({ method, params });
    return this.requestResponder(method, params);
  }

  public notify(method: string, params: unknown): void {
    this.recordedNotifies.push({ method, params });
  }

  /** Test helper: push a notification through the bound handler. */
  public pushNotification(method: string, params: unknown): void {
    if (this.notificationHandler === undefined) {
      throw new Error("pushNotification: handler not bound");
    }
    this.notificationHandler({ jsonrpc: "2.0", method, params } as AhpNotification);
  }
}

function makeStubSocket(): {
  stub: StubAhpClientSocket;
  socket: AhpClientSocket;
} {
  const stub = new StubAhpClientSocket();
  // The transport only uses `.request` and `.notify`; cast through the type
  // system since the stub doesn't implement the full AhpClientSocket surface.
  return { stub, socket: stub as unknown as AhpClientSocket };
}

function makeSpawnParams(overrides: Partial<CreateSessionParams> = {}): CreateSessionParams {
  return {
    sessionId: "sess-1",
    runtime: "claude-code",
    prompt: "hello",
    model: "claude-opus-4-7",
    maxTurns: 10,
    branch: "",
    workingDirectory: "/workspace",
    systemContext: "",
    taskId: "task-1",
    mcpServersJson: "{}",
    mcpUrl: "http://localhost:7435",
    mcpToken: "tok",
    ...overrides,
  };
}

async function collectN(
  iter: AsyncIterable<ServerActionEnvelope>,
  n: number,
  timeoutMs: number = 500,
): Promise<ServerActionEnvelope[]> {
  const result: ServerActionEnvelope[] = [];
  const deadline = Date.now() + timeoutMs;
  const it = iter[Symbol.asyncIterator]();
  while (result.length < n) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`collectN timed out at ${result.length}/${n}`);
    }
    const winner = await Promise.race([
      it.next(),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), remaining)),
    ]);
    if (winner === "timeout") {
      throw new Error(`collectN timed out at ${result.length}/${n}`);
    }
    if (winner.done === true) {
      return result;
    }
    result.push(winner.value);
  }
  return result;
}

describe("AhpHostTransport", () => {
  let cleanup: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanup) fn();
    cleanup = [];
  });

  describe("createSession", () => {
    it("sends AHP `createSession` then `subscribe`, both keyed by `ahp-session:/{sessionId}`", async () => {
      const { stub, socket } = makeStubSocket();
      stub.requestResponder = (method) => {
        if (method === "subscribe") {
          return { snapshot: undefined } satisfies SubscribeResult;
        }
        return null;
      };
      const transport = new AhpHostTransport(socket);
      stub.bindHandler(bindNotificationHandler(transport));

      const { sessionUri } = transport.createSession(makeSpawnParams());
      expect(sessionUri).toBe("ahp-session:/sess-1");

      // Wait for the createSession + subscribe RPC pair to fire.
      await new Promise((r) => setTimeout(r, 20));
      const createCall = stub.recordedRequests.find((r) => r.method === "createSession");
      const subscribeCall = stub.recordedRequests.find((r) => r.method === "subscribe");
      expect(createCall).toBeDefined();
      expect(subscribeCall).toBeDefined();
      expect((createCall?.params as { channel: string }).channel).toBe("ahp-session:/sess-1");
      expect((subscribeCall?.params as { channel: string }).channel).toBe("ahp-session:/sess-1");
    });

    it("carries Grackle spawn fields in the AHP `createSession.config`", async () => {
      const { stub, socket } = makeStubSocket();
      const transport = new AhpHostTransport(socket);
      stub.bindHandler(bindNotificationHandler(transport));

      transport.createSession(
        makeSpawnParams({
          prompt: "do a thing",
          maxTurns: 5,
          mcpUrl: "http://broker",
          workspaceId: "ws-1",
        }),
      );
      await new Promise((r) => setTimeout(r, 20));
      const createCall = stub.recordedRequests.find((r) => r.method === "createSession");
      const config = (createCall?.params as { config: Record<string, unknown> }).config;
      expect(config.prompt).toBe("do a thing");
      expect(config.maxTurns).toBe(5);
      expect(config.mcpUrl).toBe("http://broker");
      expect(config.workspaceId).toBe("ws-1");
      // resumeFromRuntimeSessionId is only set for reanimate.
      expect(config.resumeFromRuntimeSessionId).toBeUndefined();
    });

    it("folds inbound `action` notifications via reverse mapper into envelope stream", async () => {
      const { stub, socket } = makeStubSocket();
      stub.requestResponder = () => null;
      const transport = new AhpHostTransport(socket);
      stub.bindHandler(bindNotificationHandler(transport));

      const { stream } = transport.createSession(makeSpawnParams());
      // Push an action notification for the session channel.
      const action: StateAction = {
        type: ActionType.SessionTurnStarted,
        turnId: "turn-1",
        userMessage: { text: "hi from server" },
      };
      stub.pushNotification("action", {
        channel: "ahp-session:/sess-1",
        serverSeq: 1,
        action,
        origin: undefined,
      });

      const envelopes = await collectN(stream, 1);
      expect(envelopes[0]?.event.type).toBe("turn_started");
      expect(envelopes[0]?.event.turnId).toBe("turn-1");
      expect(envelopes[0]?.actions).toEqual([action]);
    });

    it("notifications for unknown channels are silently dropped", () => {
      const { stub, socket } = makeStubSocket();
      const transport = new AhpHostTransport(socket);
      stub.bindHandler(bindNotificationHandler(transport));

      // No session subscribed; push for an unrelated channel.
      expect(() =>
        stub.pushNotification("action", {
          channel: "ahp-session:/nonexistent",
          serverSeq: 1,
          action: { type: ActionType.SessionTurnStarted, turnId: "t", userMessage: { text: "x" } },
          origin: undefined,
        }),
      ).not.toThrow();
    });

    it("non-`action` notifications are ignored", () => {
      const { stub, socket } = makeStubSocket();
      const transport = new AhpHostTransport(socket);
      stub.bindHandler(bindNotificationHandler(transport));
      expect(() => stub.pushNotification("root/sessionAdded", {})).not.toThrow();
      expect(() =>
        stub.pushNotification("auth/required", {
          channel: "ahp-root://",
          reason: AuthRequiredReason.MissingCredentials,
          requestId: "r1",
        }),
      ).not.toThrow();
    });
  });

  describe("reanimate", () => {
    it("sends AHP `createSession` with `config.resumeFromRuntimeSessionId`", async () => {
      const { stub, socket } = makeStubSocket();
      const transport = new AhpHostTransport(socket);
      stub.bindHandler(bindNotificationHandler(transport));

      const params: ReanimateParams = {
        sessionId: "sess-2",
        runtimeSessionId: "rt-xyz",
        runtime: "claude-code",
      };
      transport.reanimate(params);
      await new Promise((r) => setTimeout(r, 20));

      const createCall = stub.recordedRequests.find((r) => r.method === "createSession");
      const config = (createCall?.params as { config: Record<string, unknown> }).config;
      expect(config.resumeFromRuntimeSessionId).toBe("rt-xyz");
      const subscribeCall = stub.recordedRequests.find((r) => r.method === "subscribe");
      expect((subscribeCall?.params as { channel: string }).channel).toBe("ahp-session:/sess-2");
    });
  });

  describe("dispatchInput", () => {
    it("fires `dispatchAction` notification with SessionTurnStartedAction payload + monotone clientSeq", async () => {
      const { stub, socket } = makeStubSocket();
      const transport = new AhpHostTransport(socket);
      stub.bindHandler(bindNotificationHandler(transport));

      await transport.dispatchInput("ahp-session:/sess-1", "hi");
      await transport.dispatchInput("ahp-session:/sess-1", "yo");

      const dispatches = stub.recordedNotifies.filter((n) => n.method === "dispatchAction");
      expect(dispatches).toHaveLength(2);
      const first = dispatches[0]!.params as {
        channel: string;
        clientSeq: number;
        action: { type: string; userMessage: { text: string } };
      };
      expect(first.channel).toBe("ahp-session:/sess-1");
      expect(first.clientSeq).toBe(1);
      expect(first.action.type).toBe(ActionType.SessionTurnStarted);
      expect(first.action.userMessage.text).toBe("hi");
      const second = dispatches[1]!.params as { clientSeq: number };
      expect(second.clientSeq).toBe(2);
    });
  });

  describe("authenticate", () => {
    it("fans tokens into N AHP `authenticate` calls, each with `grackle://` resource scheme", async () => {
      const { stub, socket } = makeStubSocket();
      stub.requestResponder = () => ({}) satisfies AuthenticateResult;
      const transport = new AhpHostTransport(socket);
      stub.bindHandler(bindNotificationHandler(transport));

      const params: AuthenticateParams = {
        provider: "claude-code",
        tokens: [
          { name: "api-key", type: "env_var", envVar: "ANTHROPIC_KEY", value: "sk-..." },
          {
            name: "token-file",
            type: "file",
            filePath: "/home/.creds/anthropic.json",
            value: '{"foo":1}',
          },
        ],
      };
      await transport.authenticate(params);

      const authCalls = stub.recordedRequests.filter((r) => r.method === "authenticate");
      expect(authCalls).toHaveLength(2);
      const first = authCalls[0]!.params as { resource: string; token: string };
      expect(first.resource).toBe("grackle://provider/claude-code/api-key");
      const firstToken = JSON.parse(first.token) as { type: string; envVar: string; value: string };
      expect(firstToken.type).toBe("env_var");
      expect(firstToken.envVar).toBe("ANTHROPIC_KEY");
      expect(firstToken.value).toBe("sk-...");
      const second = authCalls[1]!.params as { resource: string; token: string };
      expect(second.resource).toBe("grackle://provider/claude-code/token-file");
      const secondToken = JSON.parse(second.token) as { type: string; filePath: string };
      expect(secondToken.type).toBe("file");
      expect(secondToken.filePath).toBe("/home/.creds/anthropic.json");
    });

    it("rejects with the first failure if any token call fails", async () => {
      const { stub, socket } = makeStubSocket();
      stub.requestResponder = (_method, params) => {
        const { resource } = params as { resource: string };
        if (resource.endsWith("bad-token")) {
          throw new Error("upstream rejected");
        }
        return {};
      };
      const transport = new AhpHostTransport(socket);
      stub.bindHandler(bindNotificationHandler(transport));

      await expect(
        transport.authenticate({
          provider: "claude-code",
          tokens: [
            { name: "good", type: "env_var", value: "v1" },
            { name: "bad-token", type: "env_var", value: "v2" },
          ],
        }),
      ).rejects.toThrow(/upstream rejected/);
    });

    it("resolves with no tokens", async () => {
      const { stub, socket } = makeStubSocket();
      const transport = new AhpHostTransport(socket);
      stub.bindHandler(bindNotificationHandler(transport));
      await expect(
        transport.authenticate({ provider: "claude-code", tokens: [] }),
      ).resolves.toBeUndefined();
    });
  });

  describe("dispose", () => {
    it("sends AHP `disposeSession` and closes the per-session queue", async () => {
      const { stub, socket } = makeStubSocket();
      const transport = new AhpHostTransport(socket);
      stub.bindHandler(bindNotificationHandler(transport));

      const { stream } = transport.createSession(makeSpawnParams());
      await new Promise((r) => setTimeout(r, 20));

      // Consume the iterable in the background.
      const consumer = (async (): Promise<number> => {
        let count = 0;
        for await (const _ of stream) {
          count++;
        }
        return count;
      })();

      await transport.dispose("ahp-session:/sess-1", "user-requested");
      const disposed = stub.recordedRequests.find((r) => r.method === "disposeSession");
      expect(disposed).toBeDefined();
      expect((disposed?.params as { channel: string }).channel).toBe("ahp-session:/sess-1");

      // The stream should have closed; consumer returns.
      const count = await Promise.race([
        consumer,
        new Promise<number>((resolve) => setTimeout(() => resolve(-1), 100)),
      ]);
      expect(count).toBe(0); // closed without yielding
    });
  });

  describe("listSessions", () => {
    it("sends AHP `listSessions` on root channel; maps result to HostSessionInfo", async () => {
      const { stub, socket } = makeStubSocket();
      const summary: SessionSummary = {
        resource: "ahp-session:/abc",
        provider: "claude-code",
        title: "Demo",
        status: SessionStatus.Idle,
        createdAt: 100,
        modifiedAt: 200,
      };
      const result: ListSessionsResult = { items: [summary] };
      stub.requestResponder = (method) => (method === "listSessions" ? result : null);
      const transport = new AhpHostTransport(socket);
      stub.bindHandler(bindNotificationHandler(transport));

      const sessions = await transport.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.sessionId).toBe("abc");
      expect(sessions[0]?.runtime).toBe("claude-code");
      // status is a bitset enum; we stringify it
      expect(sessions[0]?.status).toBe(String(SessionStatus.Idle));

      const call = stub.recordedRequests.find((r) => r.method === "listSessions");
      expect((call?.params as { channel: string }).channel).toBe("ahp-root://");
    });
  });

  describe("error surfacing", () => {
    it("if `createSession` rejects, the stream yields error + status:failed and closes", async () => {
      const { stub, socket } = makeStubSocket();
      stub.requestResponder = (method) => {
        if (method === "createSession") throw new Error("boot failure");
        return null;
      };
      const transport = new AhpHostTransport(socket);
      stub.bindHandler(bindNotificationHandler(transport));

      const { stream } = transport.createSession(makeSpawnParams());
      const events: ServerActionEnvelope[] = [];
      for await (const env of stream) {
        events.push(env);
      }
      expect(events.map((e) => e.event.type)).toEqual(["error", "status"]);
      expect(events[0]?.event.content).toBe("boot failure");
      expect(events[1]?.event.content).toBe("failed");
    });
  });

  describe("multiple coexisting sessions", () => {
    it("routes notifications to the right session by channel", async () => {
      const { stub, socket } = makeStubSocket();
      const transport = new AhpHostTransport(socket);
      stub.bindHandler(bindNotificationHandler(transport));

      const a = transport.createSession(makeSpawnParams({ sessionId: "a" }));
      const b = transport.createSession(makeSpawnParams({ sessionId: "b" }));

      stub.pushNotification("action", {
        channel: "ahp-session:/a",
        serverSeq: 1,
        action: {
          type: ActionType.SessionResponsePart,
          turnId: "t",
          part: { kind: ResponsePartKind.Markdown, id: "p", content: "from A" },
        },
        origin: undefined,
      });

      // Snapshot both queues without blocking.
      const aSeen = await Promise.race([
        collectN(a.stream, 1, 100),
        new Promise<ServerActionEnvelope[]>((resolve) => setTimeout(() => resolve([]), 80)),
      ]);
      const bSeen = await Promise.race([
        collectN(b.stream, 1, 50),
        new Promise<ServerActionEnvelope[]>((resolve) => setTimeout(() => resolve([]), 30)),
      ]);
      expect(aSeen).toHaveLength(1);
      expect(bSeen).toHaveLength(0);
      void vi.fn(); // touch vi so it stays imported (tests use it indirectly via the test framework)
    });
  });
});
