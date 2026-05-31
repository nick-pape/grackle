/**
 * Unit tests for the operator stream control plane (#1309): operatorCreateStream,
 * operatorAttachTask, operatorDetachTask, listTaskAttachments, operatorCloseStream.
 *
 * Uses the real in-memory stream registry; mocks taskStore/sessionStore so we can
 * drive task -> live-session resolution.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";

vi.mock("@grackle-ai/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@grackle-ai/database")>();
  actual.openDatabase(":memory:");
  actual.initDatabase();
  return {
    ...actual,
    taskStore: { ...actual.taskStore, getTask: vi.fn() },
    sessionStore: { ...actual.sessionStore, listSessionsForTask: vi.fn(() => []) },
  };
});

import { streamRegistry, pipeDelivery, subscribe, OPERATOR_PRINCIPAL } from "@grackle-ai/core";
import { taskStore, sessionStore } from "@grackle-ai/database";
import {
  operatorCreateStream,
  operatorAttachTask,
  operatorDetachTask,
  listTaskAttachments,
  operatorCloseStream,
} from "./session-handlers.js";

vi.spyOn(pipeDelivery, "ensureAsyncDeliveryListener").mockImplementation(() => vi.fn());
vi.spyOn(pipeDelivery, "cleanupAsyncListenerIfEmpty").mockImplementation(() => vi.fn());

const getTaskMock = vi.mocked(taskStore.getTask);
const listSessionsMock = vi.mocked(sessionStore.listSessionsForTask);

/** Make `taskId` resolve to a single live (running) session `sessionId`. */
function setLiveTask(taskId: string, sessionId: string): void {
  getTaskMock.mockImplementation((id) => (id === taskId ? ({ id: taskId } as never) : undefined));
  listSessionsMock.mockImplementation((id) =>
    id === taskId
      ? ([{ id: sessionId, status: "running", startedAt: "2025-01-01T00:00:00Z" }] as never)
      : [],
  );
}

/** Make `taskId` exist but have no live session (all terminal). */
function setDeadTask(taskId: string): void {
  getTaskMock.mockImplementation((id) => (id === taskId ? ({ id: taskId } as never) : undefined));
  listSessionsMock.mockImplementation((id) =>
    id === taskId
      ? ([{ id: "s-old", status: "stopped", startedAt: "2025-01-01T00:00:00Z" }] as never)
      : [],
  );
}

async function newRoom(name: string): Promise<string> {
  const res = await operatorCreateStream(
    create(grackle.OperatorCreateStreamRequestSchema, { name }),
  );
  return res.streamId;
}

describe("operatorCreateStream", () => {
  beforeEach(() => {
    streamRegistry._resetForTesting();
    vi.clearAllMocks();
  });

  it("creates a room and plants the operator anchor (rw/detach)", async () => {
    const streamId = await newRoom("planning-room");
    const stream = streamRegistry.getStream(streamId);
    expect(stream).toBeDefined();
    const subs = Array.from(stream!.subscriptions.values());
    expect(subs).toHaveLength(1);
    expect(subs[0].sessionId).toBe(OPERATOR_PRINCIPAL);
    expect(subs[0].permission).toBe("rw");
    expect(subs[0].deliveryMode).toBe("detach");
  });

  it("rejects reserved-prefix names", async () => {
    for (const name of ["lifecycle:x", "pipe:y", "stdin:z"]) {
      const req = create(grackle.OperatorCreateStreamRequestSchema, { name });
      await expect(operatorCreateStream(req)).rejects.toMatchObject({ code: Code.InvalidArgument });
    }
  });

  it("rejects a missing name", async () => {
    const req = create(grackle.OperatorCreateStreamRequestSchema, { name: "" });
    await expect(operatorCreateStream(req)).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it("rejects a duplicate name with AlreadyExists", async () => {
    await newRoom("dup");
    const req = create(grackle.OperatorCreateStreamRequestSchema, { name: "dup" });
    await expect(operatorCreateStream(req)).rejects.toMatchObject({ code: Code.AlreadyExists });
  });
});

describe("operatorAttachTask", () => {
  beforeEach(() => {
    streamRegistry._resetForTesting();
    vi.clearAllMocks();
  });

  it("attaches a task's live session and registers the async listener", async () => {
    const streamId = await newRoom("room");
    setLiveTask("task-1", "sess-1");

    const res = await operatorAttachTask(
      create(grackle.OperatorAttachTaskRequestSchema, { taskId: "task-1", streamId }),
    );

    expect(res.sessionId).toBe("sess-1");
    expect(res.fd).toBeGreaterThanOrEqual(3);
    expect(pipeDelivery.ensureAsyncDeliveryListener).toHaveBeenCalledWith("sess-1");
    const sub = streamRegistry.getSubscription("sess-1", res.fd);
    expect(sub!.streamId).toBe(streamId);
    expect(sub!.permission).toBe("rw");
  });

  it("fails with FailedPrecondition when the task has no live session", async () => {
    const streamId = await newRoom("room");
    setDeadTask("task-1");
    await expect(
      operatorAttachTask(
        create(grackle.OperatorAttachTaskRequestSchema, { taskId: "task-1", streamId }),
      ),
    ).rejects.toMatchObject({ code: Code.FailedPrecondition });
  });

  it("fails with NotFound for an unknown stream", async () => {
    setLiveTask("task-1", "sess-1");
    await expect(
      operatorAttachTask(
        create(grackle.OperatorAttachTaskRequestSchema, { taskId: "task-1", streamId: "nope" }),
      ),
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it("fails with NotFound for an unknown task", async () => {
    const streamId = await newRoom("room");
    getTaskMock.mockReturnValue(undefined);
    await expect(
      operatorAttachTask(
        create(grackle.OperatorAttachTaskRequestSchema, { taskId: "ghost", streamId }),
      ),
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it("rejects an invalid permission/delivery combination (w + async)", async () => {
    const streamId = await newRoom("room");
    setLiveTask("task-1", "sess-1");
    await expect(
      operatorAttachTask(
        create(grackle.OperatorAttachTaskRequestSchema, {
          taskId: "task-1",
          streamId,
          permission: "w",
          deliveryMode: "async",
        }),
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });
});

describe("anchor keeps the room alive at zero agents", () => {
  beforeEach(() => {
    streamRegistry._resetForTesting();
    vi.clearAllMocks();
  });

  it("survives an agent attach + detach", async () => {
    const streamId = await newRoom("room");
    setLiveTask("task-1", "sess-1");

    await operatorAttachTask(
      create(grackle.OperatorAttachTaskRequestSchema, { taskId: "task-1", streamId }),
    );
    expect(streamRegistry.getStream(streamId)!.subscriptions.size).toBe(2);

    const res = await operatorDetachTask(
      create(grackle.OperatorDetachTaskRequestSchema, { taskId: "task-1", streamId }),
    );
    expect(res.detached).toBe(true);

    // Room still exists — only the operator anchor remains.
    const stream = streamRegistry.getStream(streamId);
    expect(stream).toBeDefined();
    expect(stream!.subscriptions.size).toBe(1);
  });
});

describe("operatorDetachTask", () => {
  beforeEach(() => {
    streamRegistry._resetForTesting();
    vi.clearAllMocks();
  });

  it("returns detached=false when the task has no live session", async () => {
    const streamId = await newRoom("room");
    setDeadTask("task-1");
    const res = await operatorDetachTask(
      create(grackle.OperatorDetachTaskRequestSchema, { taskId: "task-1", streamId }),
    );
    expect(res.detached).toBe(false);
  });

  it("returns detached=false when the live session is not on the stream", async () => {
    const streamId = await newRoom("room");
    setLiveTask("task-1", "sess-1");
    const res = await operatorDetachTask(
      create(grackle.OperatorDetachTaskRequestSchema, { taskId: "task-1", streamId }),
    );
    expect(res.detached).toBe(false);
  });
});

describe("listTaskAttachments", () => {
  beforeEach(() => {
    streamRegistry._resetForTesting();
    vi.clearAllMocks();
  });

  it("lists the live session's non-reserved room subscriptions", async () => {
    const streamId = await newRoom("room");
    setLiveTask("task-1", "sess-1");
    await operatorAttachTask(
      create(grackle.OperatorAttachTaskRequestSchema, { taskId: "task-1", streamId }),
    );

    const res = await listTaskAttachments(
      create(grackle.ListTaskAttachmentsRequestSchema, { taskId: "task-1" }),
    );
    expect(res.attachments).toHaveLength(1);
    expect(res.attachments[0].streamId).toBe(streamId);
    expect(res.attachments[0].streamName).toBe("room");
    expect(res.attachments[0].sessionId).toBe("sess-1");
  });

  it("returns an empty list when the task has no live session", async () => {
    setDeadTask("task-1");
    const res = await listTaskAttachments(
      create(grackle.ListTaskAttachmentsRequestSchema, { taskId: "task-1" }),
    );
    expect(res.attachments).toHaveLength(0);
  });
});

describe("operatorCloseStream", () => {
  beforeEach(() => {
    streamRegistry._resetForTesting();
    vi.clearAllMocks();
  });

  it("removes the room (anchor included)", async () => {
    const streamId = await newRoom("room");
    const res = await operatorCloseStream(
      create(grackle.OperatorCloseStreamRequestSchema, { streamId }),
    );
    expect(res.closed).toBe(true);
    expect(streamRegistry.getStream(streamId)).toBeUndefined();
  });

  it("fails with NotFound for an unknown stream", async () => {
    await expect(
      operatorCloseStream(create(grackle.OperatorCloseStreamRequestSchema, { streamId: "nope" })),
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it("refuses to close a reserved plumbing stream", async () => {
    const plumbing = streamRegistry.createStream("pipe:internal");
    await expect(
      operatorCloseStream(
        create(grackle.OperatorCloseStreamRequestSchema, { streamId: plumbing.id }),
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });
});

describe("lifecycle events reach the domain-event bus (wire)", () => {
  beforeEach(() => {
    streamRegistry._resetForTesting();
    vi.clearAllMocks();
  });

  it("operatorCreateStream emits stream.created + stream.attached to subscribers", async () => {
    const events: string[] = [];
    const unsub = subscribe((e) => events.push(e.type));

    await newRoom("room");
    // Domain events fan out on a microtask — flush before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsub();

    expect(events).toContain("stream.created");
    expect(events).toContain("stream.attached");
  });
});
