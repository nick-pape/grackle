import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mock dependencies ────────────────────────────────────────

vi.mock("@grackle-ai/database", async () => {
  const { createDatabaseMock } = await import("../test-utils/mock-database.js");
  return createDatabaseMock();
});

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./signal-delivery.js", () => ({
  deliverSignalToTask: vi.fn().mockResolvedValue(true),
  sendInputToSession: vi.fn().mockResolvedValue(true),
}));

vi.mock("../stream-registry.js", () => ({
  getSubscriptionsForSession: vi.fn(() => []),
  getStream: vi.fn(() => undefined),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("../pipe-delivery.js", () => ({
  ensureAsyncDeliveryListener: vi.fn(),
  cleanupAsyncListenerIfEmpty: vi.fn(),
}));

// ── Imports ──────────────────────────────────────────────────

import { taskStore, sessionStore } from "@grackle-ai/database";
import { deliverSignalToTask } from "./signal-delivery.js";
import * as streamRegistry from "../stream-registry.js";
import { ensureAsyncDeliveryListener } from "../pipe-delivery.js";
import { createOrphanReparentSubscriber } from "./orphan-reparent.js";
import type { GrackleEvent } from "../event-bus.js";
import type { Disposable, PluginContext } from "../subscriber-types.js";

// ── Helpers ──────────────────────────────────────────────────

/** Wait for async fire-and-forget handlers to complete. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const PARENT_TASK = {
  id: "parent-1",
  parentTaskId: "grandparent-1",
  workspaceId: "ws-1",
  title: "Parent Task",
  status: "complete",
  depth: 1,
};

const GRANDPARENT_TASK = {
  id: "grandparent-1",
  parentTaskId: "",
  workspaceId: "ws-1",
  title: "Grandparent Task",
  status: "working",
  depth: 0,
  canDecompose: true,
};

const CHILD_TASK_1 = {
  id: "child-1",
  parentTaskId: "parent-1",
  workspaceId: "ws-1",
  title: "Child One",
  status: "not_started",
  depth: 2,
};

const CHILD_TASK_2 = {
  id: "child-2",
  parentTaskId: "parent-1",
  workspaceId: "ws-1",
  title: "Child Two",
  status: "working",
  depth: 2,
};

// ── Tests ────────────────────────────────────────────────────

describe("createOrphanReparentSubscriber", () => {
  let ctx: PluginContext;
  let capturedHandler: (event: GrackleEvent) => void;
  let disposable: Disposable;
  let unsubscribeFn: ReturnType<typeof vi.fn>;

  /** Simulate an event by calling the subscriber callback directly. */
  function fireEvent(event: Partial<GrackleEvent>): void {
    capturedHandler(event as GrackleEvent);
  }

  beforeEach(() => {
    vi.clearAllMocks();

    unsubscribeFn = vi.fn();
    ctx = {
      subscribe: vi.fn((fn: (event: GrackleEvent) => void) => {
        capturedHandler = fn;
        return unsubscribeFn;
      }),
      emit: vi.fn(),
    };

    disposable = createOrphanReparentSubscriber(ctx);
  });

  afterEach(() => {
    disposable.dispose();
  });

  it("subscribes to event bus on creation", () => {
    expect(ctx.subscribe).toHaveBeenCalledOnce();
  });

  it("unsubscribes on dispose", () => {
    disposable.dispose();
    expect(unsubscribeFn).toHaveBeenCalledOnce();
  });

  describe("task.completed events", () => {
    it("reparents non-terminal children to grandparent when parent completes", async () => {
      vi.mocked(taskStore.getTask)
        .mockReturnValueOnce(PARENT_TASK as never) // lookup parent
        .mockReturnValueOnce(PARENT_TASK as never); // second check
      vi.mocked(taskStore.getOrphanedTasks).mockReturnValue([CHILD_TASK_1] as never);

      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      expect(taskStore.reparentTask).toHaveBeenCalledWith("child-1", "grandparent-1");
    });

    it("reparents multiple children", async () => {
      vi.mocked(taskStore.getTask)
        .mockReturnValueOnce(PARENT_TASK as never)
        .mockReturnValueOnce(PARENT_TASK as never);
      vi.mocked(taskStore.getOrphanedTasks).mockReturnValue([CHILD_TASK_1, CHILD_TASK_2] as never);

      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      expect(taskStore.reparentTask).toHaveBeenCalledTimes(2);
      expect(taskStore.reparentTask).toHaveBeenCalledWith("child-1", "grandparent-1");
      expect(taskStore.reparentTask).toHaveBeenCalledWith("child-2", "grandparent-1");
    });

    it("does nothing when parent has no children", async () => {
      vi.mocked(taskStore.getTask).mockReturnValue(PARENT_TASK as never);
      vi.mocked(taskStore.getOrphanedTasks).mockReturnValue([]);

      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      expect(taskStore.reparentTask).not.toHaveBeenCalled();
    });

    it("emits task.reparented event via ctx.emit for each child", async () => {
      vi.mocked(taskStore.getTask)
        .mockReturnValueOnce(PARENT_TASK as never)
        .mockReturnValueOnce(PARENT_TASK as never);
      vi.mocked(taskStore.getOrphanedTasks).mockReturnValue([CHILD_TASK_1] as never);

      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      expect(ctx.emit).toHaveBeenCalledWith("task.reparented", expect.objectContaining({
        taskId: "child-1",
        oldParentTaskId: "parent-1",
        newParentTaskId: "grandparent-1",
      }));
    });

    it("emits task.updated event via ctx.emit for each reparented child", async () => {
      vi.mocked(taskStore.getTask)
        .mockReturnValueOnce(PARENT_TASK as never)
        .mockReturnValueOnce(PARENT_TASK as never);
      vi.mocked(taskStore.getOrphanedTasks).mockReturnValue([CHILD_TASK_1] as never);

      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      expect(ctx.emit).toHaveBeenCalledWith("task.updated", expect.objectContaining({
        taskId: "child-1",
        workspaceId: "ws-1",
      }));
    });

    it("delivers [ADOPTED] signal to grandparent", async () => {
      vi.mocked(taskStore.getTask)
        .mockReturnValueOnce(PARENT_TASK as never)
        .mockReturnValueOnce(PARENT_TASK as never);
      vi.mocked(taskStore.getOrphanedTasks).mockReturnValue([CHILD_TASK_1] as never);

      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      expect(deliverSignalToTask).toHaveBeenCalledWith(
        "grandparent-1",
        "adopted",
        expect.stringContaining("[ADOPTED]"),
      );
    });
  });

  describe("task.updated events", () => {
    it("reparents when task status is terminal (failed)", async () => {
      const failedParent = { ...PARENT_TASK, status: "failed" };
      vi.mocked(taskStore.getTask)
        .mockReturnValueOnce(failedParent as never)
        .mockReturnValueOnce(failedParent as never);
      vi.mocked(taskStore.getOrphanedTasks).mockReturnValue([CHILD_TASK_1] as never);

      fireEvent({ type: "task.updated", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      expect(taskStore.reparentTask).toHaveBeenCalledWith("child-1", "grandparent-1");
    });

    it("ignores non-terminal task.updated events", async () => {
      const workingParent = { ...PARENT_TASK, status: "working" };
      vi.mocked(taskStore.getTask).mockReturnValue(workingParent as never);
      vi.mocked(taskStore.getOrphanedTasks).mockReturnValue([]);

      fireEvent({ type: "task.updated", payload: { taskId: "parent-2", workspaceId: "ws-1" } });
      await flush();

      expect(taskStore.reparentTask).not.toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("ignores non-task events", async () => {
      fireEvent({ type: "workspace.created" as never, payload: { workspaceId: "ws-1" } });
      await flush();

      expect(taskStore.getTask).not.toHaveBeenCalled();
    });

    it("reparents to ROOT_TASK_ID when parent has no grandparent", async () => {
      // Use fresh mocks and unique IDs to avoid async leakage from prior tests
      vi.mocked(taskStore.getTask).mockReset();
      vi.mocked(taskStore.getOrphanedTasks).mockReset();
      vi.mocked(taskStore.reparentTask).mockReset();

      const parentId = "no-gp-parent-unique";
      const rootChild = { ...PARENT_TASK, id: parentId, parentTaskId: "" };
      const orphan = { ...CHILD_TASK_1, id: "orphan-root-unique", parentTaskId: parentId };
      vi.mocked(taskStore.getTask).mockReturnValue(rootChild as never);
      vi.mocked(taskStore.getOrphanedTasks).mockReturnValue([orphan] as never);

      fireEvent({ type: "task.completed", payload: { taskId: parentId, workspaceId: "ws-1" } });
      await flush();

      expect(taskStore.reparentTask).toHaveBeenCalledWith("orphan-root-unique", "system");
    });

    it("does not reparent twice for the same parent (deduplication)", async () => {
      vi.mocked(taskStore.getTask).mockReturnValue(PARENT_TASK as never);
      vi.mocked(taskStore.getOrphanedTasks).mockReturnValue([CHILD_TASK_1] as never);

      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      expect(taskStore.reparentTask).toHaveBeenCalledTimes(1);
    });

    it("logs errors but does not throw", async () => {
      vi.mocked(taskStore.getTask).mockReturnValue(PARENT_TASK as never);
      vi.mocked(taskStore.getOrphanedTasks).mockImplementation(() => {
        throw new Error("DB error");
      });

      // Should not throw
      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      // No assertion needed — just verifying no throw
    });

    it("continues reparenting remaining children if one fails", async () => {
      vi.mocked(taskStore.getTask).mockReturnValue(PARENT_TASK as never);
      vi.mocked(taskStore.getOrphanedTasks).mockReturnValue([CHILD_TASK_1, CHILD_TASK_2] as never);
      vi.mocked(taskStore.reparentTask)
        .mockImplementationOnce(() => { throw new Error("fail first"); })
        .mockImplementationOnce(() => {});

      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      // Second child should still be attempted
      expect(taskStore.reparentTask).toHaveBeenCalledTimes(2);
    });

    it("skips ROOT_TASK_ID as parent", async () => {
      fireEvent({ type: "task.completed", payload: { taskId: "system", workspaceId: "ws-1" } });
      await flush();

      expect(taskStore.getOrphanedTasks).not.toHaveBeenCalled();
    });
  });

  describe("pipe fd transfer", () => {
    it("transfers pipe subscriptions from dead parent to grandparent session", async () => {
      vi.mocked(taskStore.getTask).mockReset();
      vi.mocked(taskStore.getOrphanedTasks).mockReset();
      vi.mocked(taskStore.reparentTask).mockReset();

      const parentId = "pipe-parent";
      const parent = { ...PARENT_TASK, id: parentId };
      const orphan = { ...CHILD_TASK_1, id: "pipe-child", parentTaskId: parentId };

      vi.mocked(taskStore.getTask).mockReturnValue(parent as never);
      vi.mocked(taskStore.getOrphanedTasks).mockReturnValue([orphan] as never);

      // Parent has a session with a pipe subscription
      vi.mocked(sessionStore.listSessionsForTask).mockReturnValue([
        { id: "parent-sess", taskId: parentId, status: "stopped" },
      ] as never);
      vi.mocked(sessionStore.getActiveSessionsForTask).mockReturnValue([
        { id: "gp-sess", taskId: "grandparent-1", status: "idle" },
      ] as never);

      // Parent session has a pipe subscription
      vi.mocked(streamRegistry.getSubscriptionsForSession).mockReturnValue([
        { id: "sub-1", streamId: "stream-1", sessionId: "parent-sess", fd: 3, permission: "rw", deliveryMode: "async", createdBySpawn: true },
      ] as never);
      vi.mocked(streamRegistry.getStream).mockReturnValue({
        id: "stream-1", name: "pipe:child-sess-1", subscriptions: new Map(),
      } as never);

      fireEvent({ type: "task.completed", payload: { taskId: parentId, workspaceId: "ws-1" } });
      await flush();

      // Should create subscription for grandparent
      expect(streamRegistry.subscribe).toHaveBeenCalledWith(
        "stream-1", "gp-sess", "rw", "async", true,
      );
      // Should remove dead parent's subscription
      expect(streamRegistry.unsubscribe).toHaveBeenCalledWith("sub-1");
      // Should set up async listener
      expect(ensureAsyncDeliveryListener).toHaveBeenCalledWith("gp-sess");
    });

    it("transfers pipe subscriptions even when no orphaned tasks exist", async () => {
      vi.mocked(taskStore.getTask).mockReset();
      vi.mocked(taskStore.getOrphanedTasks).mockReset();
      vi.mocked(taskStore.reparentTask).mockReset();

      const parentId = "pipe-only-parent";
      const parent = { ...PARENT_TASK, id: parentId };

      vi.mocked(taskStore.getTask).mockReturnValue(parent as never);
      // No orphaned tasks — child was spawned via ipc_spawn (session-only, no task)
      vi.mocked(taskStore.getOrphanedTasks).mockReturnValue([]);

      // Parent has a session with a pipe subscription
      vi.mocked(sessionStore.listSessionsForTask).mockReturnValue([
        { id: "parent-sess-only", taskId: parentId, status: "idle" },
      ] as never);
      vi.mocked(sessionStore.getActiveSessionsForTask).mockReturnValue([
        { id: "gp-sess-only", taskId: "grandparent-1", status: "idle" },
      ] as never);

      vi.mocked(streamRegistry.getSubscriptionsForSession).mockReturnValue([
        { id: "sub-only", streamId: "stream-only", sessionId: "parent-sess-only", fd: 3, permission: "rw", deliveryMode: "async", createdBySpawn: true },
      ] as never);
      vi.mocked(streamRegistry.getStream).mockReturnValue({
        id: "stream-only", name: "pipe:child-sess-only", subscriptions: new Map(),
      } as never);

      fireEvent({ type: "task.completed", payload: { taskId: parentId, workspaceId: "ws-1" } });
      await flush();

      // Pipe should be transferred even though no tasks were reparented
      expect(streamRegistry.subscribe).toHaveBeenCalledWith(
        "stream-only", "gp-sess-only", "rw", "async", true,
      );
      expect(streamRegistry.unsubscribe).toHaveBeenCalledWith("sub-only");
      expect(taskStore.reparentTask).not.toHaveBeenCalled();
    });

    it("skips non-pipe subscriptions (lifecycle streams)", async () => {
      vi.mocked(taskStore.getTask).mockReset();
      vi.mocked(taskStore.getOrphanedTasks).mockReset();
      vi.mocked(streamRegistry.subscribe).mockReset();
      vi.mocked(streamRegistry.unsubscribe).mockReset();

      const parentId = "pipe-lifecycle-parent";
      const parent = { ...PARENT_TASK, id: parentId };

      vi.mocked(taskStore.getTask).mockReturnValue(parent as never);
      vi.mocked(taskStore.getOrphanedTasks).mockReturnValue([]);

      vi.mocked(sessionStore.listSessionsForTask).mockReturnValue([
        { id: "lc-sess", taskId: parentId, status: "idle" },
      ] as never);
      vi.mocked(sessionStore.getActiveSessionsForTask).mockReturnValue([
        { id: "gp-lc-sess", taskId: "grandparent-1", status: "idle" },
      ] as never);

      // Parent session has ONLY a lifecycle subscription (no pipe:*)
      vi.mocked(streamRegistry.getSubscriptionsForSession).mockReturnValue([
        { id: "lc-sub", streamId: "lc-stream", sessionId: "lc-sess", fd: 1, permission: "rw", deliveryMode: "detach", createdBySpawn: true },
      ] as never);
      vi.mocked(streamRegistry.getStream).mockReturnValue({
        id: "lc-stream", name: "lifecycle:some-session", subscriptions: new Map(),
      } as never);

      fireEvent({ type: "task.completed", payload: { taskId: parentId, workspaceId: "ws-1" } });
      await flush();

      // Should NOT transfer lifecycle subscriptions
      expect(streamRegistry.subscribe).not.toHaveBeenCalled();
      expect(streamRegistry.unsubscribe).not.toHaveBeenCalled();
    });

    it("transfers multiple pipe subs across multiple parent sessions", async () => {
      vi.mocked(taskStore.getTask).mockReset();
      vi.mocked(taskStore.getOrphanedTasks).mockReset();
      vi.mocked(streamRegistry.subscribe).mockReset();
      vi.mocked(streamRegistry.unsubscribe).mockReset();

      const parentId = "multi-pipe-parent";
      const parent = { ...PARENT_TASK, id: parentId };

      vi.mocked(taskStore.getTask).mockReturnValue(parent as never);
      vi.mocked(taskStore.getOrphanedTasks).mockReturnValue([]);

      // Parent has TWO sessions (e.g., restarted task)
      vi.mocked(sessionStore.listSessionsForTask).mockReturnValue([
        { id: "sess-a", taskId: parentId, status: "stopped" },
        { id: "sess-b", taskId: parentId, status: "idle" },
      ] as never);
      vi.mocked(sessionStore.getActiveSessionsForTask).mockReturnValue([
        { id: "gp-multi-sess", taskId: "grandparent-1", status: "idle" },
      ] as never);

      // Each session has a pipe subscription
      vi.mocked(streamRegistry.getSubscriptionsForSession)
        .mockReturnValueOnce([
          { id: "sub-a", streamId: "stream-a", sessionId: "sess-a", fd: 3, permission: "rw", deliveryMode: "async", createdBySpawn: true },
        ] as never)
        .mockReturnValueOnce([
          { id: "sub-b", streamId: "stream-b", sessionId: "sess-b", fd: 4, permission: "rw", deliveryMode: "sync", createdBySpawn: true },
        ] as never);
      vi.mocked(streamRegistry.getStream)
        .mockReturnValueOnce({ id: "stream-a", name: "pipe:child-a", subscriptions: new Map() } as never)
        .mockReturnValueOnce({ id: "stream-b", name: "pipe:child-b", subscriptions: new Map() } as never);

      fireEvent({ type: "task.completed", payload: { taskId: parentId, workspaceId: "ws-1" } });
      await flush();

      // Both pipe subs should be transferred
      expect(streamRegistry.subscribe).toHaveBeenCalledTimes(2);
      expect(streamRegistry.subscribe).toHaveBeenCalledWith("stream-a", "gp-multi-sess", "rw", "async", true);
      expect(streamRegistry.subscribe).toHaveBeenCalledWith("stream-b", "gp-multi-sess", "rw", "sync", true);
      expect(streamRegistry.unsubscribe).toHaveBeenCalledWith("sub-a");
      expect(streamRegistry.unsubscribe).toHaveBeenCalledWith("sub-b");
    });

    it("continues transferring remaining subs if one fails", async () => {
      vi.mocked(taskStore.getTask).mockReset();
      vi.mocked(taskStore.getOrphanedTasks).mockReset();
      vi.mocked(streamRegistry.subscribe).mockReset();
      vi.mocked(streamRegistry.unsubscribe).mockReset();

      const parentId = "fail-pipe-parent";
      const parent = { ...PARENT_TASK, id: parentId };

      vi.mocked(taskStore.getTask).mockReturnValue(parent as never);
      vi.mocked(taskStore.getOrphanedTasks).mockReturnValue([]);

      vi.mocked(sessionStore.listSessionsForTask).mockReturnValue([
        { id: "fail-sess", taskId: parentId, status: "idle" },
      ] as never);
      vi.mocked(sessionStore.getActiveSessionsForTask).mockReturnValue([
        { id: "gp-fail-sess", taskId: "grandparent-1", status: "idle" },
      ] as never);

      // Two pipe subscriptions — first transfer will throw
      vi.mocked(streamRegistry.getSubscriptionsForSession).mockReturnValue([
        { id: "fail-sub-1", streamId: "fail-stream-1", sessionId: "fail-sess", fd: 3, permission: "rw", deliveryMode: "async", createdBySpawn: true },
        { id: "fail-sub-2", streamId: "fail-stream-2", sessionId: "fail-sess", fd: 4, permission: "rw", deliveryMode: "async", createdBySpawn: true },
      ] as never);
      vi.mocked(streamRegistry.getStream)
        .mockReturnValueOnce({ id: "fail-stream-1", name: "pipe:child-fail-1", subscriptions: new Map() } as never)
        .mockReturnValueOnce({ id: "fail-stream-2", name: "pipe:child-fail-2", subscriptions: new Map() } as never);

      // First subscribe call throws, second succeeds
      vi.mocked(streamRegistry.subscribe)
        .mockImplementationOnce(() => { throw new Error("subscribe boom"); })
        .mockReturnValueOnce({} as never);

      fireEvent({ type: "task.completed", payload: { taskId: parentId, workspaceId: "ws-1" } });
      await flush();

      // Second sub should still be attempted despite first failure
      expect(streamRegistry.subscribe).toHaveBeenCalledTimes(2);
      expect(streamRegistry.unsubscribe).toHaveBeenCalledWith("fail-sub-2");
    });

    it("skips transfer when no grandparent session is active", async () => {
      vi.mocked(taskStore.getTask).mockReset();
      vi.mocked(taskStore.getOrphanedTasks).mockReset();
      vi.mocked(taskStore.reparentTask).mockReset();
      vi.mocked(streamRegistry.subscribe).mockReset();

      const parentId = "pipe-parent-no-gp";
      const parent = { ...PARENT_TASK, id: parentId };
      const orphan = { ...CHILD_TASK_1, id: "pipe-child-2", parentTaskId: parentId };

      vi.mocked(taskStore.getTask).mockReturnValue(parent as never);
      vi.mocked(taskStore.getOrphanedTasks).mockReturnValue([orphan] as never);
      vi.mocked(sessionStore.getActiveSessionsForTask).mockReturnValue([] as never);

      fireEvent({ type: "task.completed", payload: { taskId: parentId, workspaceId: "ws-1" } });
      await flush();

      // Should NOT try to create subscriptions
      expect(streamRegistry.subscribe).not.toHaveBeenCalled();
    });
  });
});
