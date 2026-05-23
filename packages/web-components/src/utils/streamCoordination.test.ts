import { describe, it, expect } from "vitest";
import type { Session, StreamData, StreamSubscriberData } from "../hooks/types.js";
import { attributeStream, groupStreamsByTask, isInternalStream, streamKind } from "./streamCoordination.js";

function makeSub(sessionId: string): StreamSubscriberData {
  return { subscriptionId: `sub-${sessionId}`, sessionId, fd: 3, permission: "rw", deliveryMode: "async", createdBySpawn: false };
}

function makeStream(over: Partial<StreamData> & { id: string; name: string }): StreamData {
  return {
    subscriberCount: over.subscribers?.length ?? 0,
    messageBufferDepth: 0,
    selfEcho: false,
    subscribers: [],
    ...over,
  };
}

function makeSession(id: string, taskId?: string): Session {
  return { id, environmentId: "env-1", runtime: "claude-code", status: "running", prompt: "", startedAt: "2026-01-01T00:00:00Z", taskId };
}

describe("streamKind", () => {
  it("classifies self-echo streams as chatroom", () => {
    expect(streamKind(makeStream({ id: "1", name: "room", selfEcho: true }))).toBe("chatroom");
  });
  it("classifies pipe: streams as pipe", () => {
    expect(streamKind(makeStream({ id: "2", name: "pipe:abc" }))).toBe("pipe");
  });
  it("classifies other named streams as channel", () => {
    expect(streamKind(makeStream({ id: "3", name: "telemetry" }))).toBe("channel");
  });
});

describe("isInternalStream", () => {
  it("flags reserved prefixes", () => {
    expect(isInternalStream(makeStream({ id: "1", name: "lifecycle:x" }))).toBe(true);
    expect(isInternalStream(makeStream({ id: "2", name: "pipe:x" }))).toBe(true);
    expect(isInternalStream(makeStream({ id: "3", name: "stdin:x" }))).toBe(true);
  });
  it("does not flag normal names", () => {
    expect(isInternalStream(makeStream({ id: "4", name: "agent-chat" }))).toBe(false);
  });
});

describe("attributeStream", () => {
  const sessions = [makeSession("s-task", "task-1"), makeSession("s-orphan")];

  it("attributes to a task when a subscriber session has a taskId", () => {
    const stream = makeStream({ id: "1", name: "x", subscribers: [makeSub("s-task")] });
    expect(attributeStream(stream, sessions)).toEqual({ kind: "task", taskId: "task-1" });
  });
  it("returns unattached when the session is known but task-less", () => {
    const stream = makeStream({ id: "2", name: "x", subscribers: [makeSub("s-orphan")] });
    expect(attributeStream(stream, sessions)).toEqual({ kind: "unattached" });
  });
  it("returns external when no subscriber session is known", () => {
    const stream = makeStream({ id: "3", name: "x", subscribers: [makeSub("s-unknown")] });
    expect(attributeStream(stream, sessions)).toEqual({ kind: "external" });
  });
});

describe("groupStreamsByTask", () => {
  it("groups streams by owning task with a trailing orphan bucket", () => {
    const sessions = [makeSession("s1", "task-1"), makeSession("s2", "task-2"), makeSession("s3")];
    const streams = [
      makeStream({ id: "a", name: "a", subscribers: [makeSub("s1")] }),
      makeStream({ id: "b", name: "b", subscribers: [makeSub("s2")] }),
      makeStream({ id: "c", name: "c", subscribers: [makeSub("s1")] }),
      makeStream({ id: "d", name: "d", subscribers: [makeSub("s3")] }), // unattached
      makeStream({ id: "e", name: "e", subscribers: [makeSub("s-unknown")] }), // external
    ];
    const groups = groupStreamsByTask(streams, sessions);

    expect(groups.map((g) => g.taskId)).toEqual(["task-1", "task-2", undefined]);
    expect(groups[0].streams.map((s) => s.id)).toEqual(["a", "c"]);
    expect(groups[1].streams.map((s) => s.id)).toEqual(["b"]);
    expect(groups[2].streams.map((s) => s.id)).toEqual(["d", "e"]);
  });

  it("omits the orphan bucket when every stream is attributed", () => {
    const sessions = [makeSession("s1", "task-1")];
    const streams = [makeStream({ id: "a", name: "a", subscribers: [makeSub("s1")] })];
    const groups = groupStreamsByTask(streams, sessions);
    expect(groups).toHaveLength(1);
    expect(groups[0].taskId).toBe("task-1");
  });
});
