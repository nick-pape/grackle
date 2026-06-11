import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { setupTestDatabase } from "@grackle-ai/test-utils/db";

// ── Mock dependencies ────────────────────────────────────────

// NOTE: @grackle-ai/database is NOT mocked — real stores run against
// an in-memory SQLite database initialized by setupTestDatabase().

vi.mock("@grackle-ai/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    streamRegistry: {
      getSubscriptionsForSession: vi.fn(() => []),
      getStream: vi.fn(() => undefined),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    },
    ensureAsyncDeliveryListener: vi.fn(),
    pipeDelivery: {
      ensureAsyncDeliveryListener: vi.fn(),
      cleanupAsyncListenerIfEmpty: vi.fn(),
    },
    deliverSignalToTask: vi.fn().mockResolvedValue(true),
    sendInputToSession: vi.fn().mockResolvedValue(true),
  };
});

// ── Imports ──────────────────────────────────────────────────

import { taskStore, sessionStore, envRegistry, workspaceStore } from "@grackle-ai/database";
import { deliverSignalToTask, taskService } from "@grackle-ai/core";
import { streamRegistry, ensureAsyncDeliveryListener } from "@grackle-ai/core";
import { createOrphanReparentSubscriber } from "./orphan-reparent.js";
import type { GrackleEvent } from "@grackle-ai/core";
import type { Disposable, PluginContext } from "@grackle-ai/plugin-sdk";
import { createMockPluginContext } from "../test-utils/mock-plugin-context.js";

// ── Test DB ───────────────────────────────────────────────────

const testDb = setupTestDatabase();
afterAll(() => testDb.cleanup());

// ── Helpers ──────────────────────────────────────────────────

/** Wait for async fire-and-forget handlers to complete. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

function insertBaseEntities(): void {
  envRegistry.addEnvironment("env-1", "Test Env", "local", "{}");
  workspaceStore.createWorkspace("ws-1", "Test Workspace", "", "");
}

function insertTaskHierarchy(): void {
  // grandparent (root-level, canDecompose=true)
  taskStore.insertTask({
    id: "grandparent-1",
    workspaceId: "ws-1",
    title: "Grandparent Task",
    description: "",
    branch: "ws-1/grandparent-task",
    dependsOn: [],
    parentTaskId: "",
    depth: 0,
    canDecompose: true,
    injectKnowledge: true,
    defaultPersonaId: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  });
  // parent (child of grandparent, canDecompose=true)
  taskStore.insertTask({
    id: "parent-1",
    workspaceId: "ws-1",
    title: "Parent Task",
    description: "",
    branch: "ws-1/parent-task",
    dependsOn: [],
    parentTaskId: "grandparent-1",
    depth: 1,
    canDecompose: true,
    injectKnowledge: true,
    defaultPersonaId: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  });
  // children of parent
  taskStore.insertTask({
    id: "child-1",
    workspaceId: "ws-1",
    title: "Child One",
    description: "",
    branch: "ws-1/child-one",
    dependsOn: [],
    parentTaskId: "parent-1",
    depth: 2,
    canDecompose: false,
    injectKnowledge: true,
    defaultPersonaId: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  });
  taskStore.insertTask({
    id: "child-2",
    workspaceId: "ws-1",
    title: "Child Two",
    description: "",
    branch: "ws-1/child-two",
    dependsOn: [],
    parentTaskId: "parent-1",
    depth: 2,
    canDecompose: false,
    injectKnowledge: true,
    defaultPersonaId: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  });
}

/** Mark a task as complete so the subscriber treats it as terminal. */
function completeTask(taskId: string): void {
  taskStore.updateTaskStatus(taskId, "complete");
}

/** Mark a task as failed so the subscriber treats it as terminal. */
function failTask(taskId: string): void {
  taskStore.updateTaskStatus(taskId, "failed");
}

// ── Tests ────────────────────────────────────────────────────

describe("createOrphanReparentSubscriber", () => {
  let ctx: PluginContext;
  let capturedHandler: (event: GrackleEvent) => void | Promise<void>;
  let disposable: Disposable;
  let unsubscribeFn: ReturnType<typeof vi.fn>;

  /** Simulate an event by calling the subscriber callback directly.
   *  Mirrors the event-bus: catches any returned Promise rejection so it
   *  doesn't surface as an unhandled rejection in the test runner. */
  function fireEvent(event: Partial<GrackleEvent>): void {
    const result = capturedHandler(event as GrackleEvent);
    if (result !== undefined && typeof (result as Promise<void>).then === "function") {
      (result as Promise<void>).catch(() => {});
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    testDb.truncateAll();
    insertBaseEntities();

    unsubscribeFn = vi.fn();
    ctx = createMockPluginContext({
      subscribe: vi.fn((fn: (event: GrackleEvent) => void | Promise<void>) => {
        capturedHandler = fn;
        return unsubscribeFn;
      }),
    });

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
      insertTaskHierarchy();
      completeTask("parent-1");
      vi.spyOn(taskService, "reparentTask");

      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      expect(taskService.reparentTask).toHaveBeenCalledWith("child-1", "grandparent-1");
    });

    it("reparents multiple children", async () => {
      insertTaskHierarchy();
      completeTask("parent-1");
      vi.spyOn(taskService, "reparentTask");

      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      expect(taskService.reparentTask).toHaveBeenCalledTimes(2);
      expect(taskService.reparentTask).toHaveBeenCalledWith("child-1", "grandparent-1");
      expect(taskService.reparentTask).toHaveBeenCalledWith("child-2", "grandparent-1");
    });

    it("does nothing when parent has no children", async () => {
      // Create parent without children
      taskStore.insertTask({
        id: "lonely-parent",
        workspaceId: "ws-1",
        title: "Lonely",
        description: "",
        branch: "ws-1/lonely",
        dependsOn: [],
        parentTaskId: "",
        depth: 0,
        canDecompose: true,
        injectKnowledge: true,
        defaultPersonaId: "",
        tokenBudget: 0,
        costBudgetMillicents: 0,
      });
      completeTask("lonely-parent");
      vi.spyOn(taskService, "reparentTask");

      fireEvent({
        type: "task.completed",
        payload: { taskId: "lonely-parent", workspaceId: "ws-1" },
      });
      await flush();

      expect(taskService.reparentTask).not.toHaveBeenCalled();
    });

    it("emits task.reparented event via ctx.emit for each child", async () => {
      insertTaskHierarchy();
      completeTask("parent-1");

      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      expect(ctx.emit).toHaveBeenCalledWith(
        "task.reparented",
        expect.objectContaining({
          taskId: "child-1",
          oldParentTaskId: "parent-1",
          newParentTaskId: "grandparent-1",
        }),
      );
    });

    it("emits task.updated event via ctx.emit for each reparented child", async () => {
      insertTaskHierarchy();
      completeTask("parent-1");

      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      expect(ctx.emit).toHaveBeenCalledWith(
        "task.updated",
        expect.objectContaining({
          taskId: "child-1",
          workspaceId: "ws-1",
        }),
      );
    });

    it("delivers [ADOPTED] signal to grandparent", async () => {
      insertTaskHierarchy();
      completeTask("parent-1");

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
      insertTaskHierarchy();
      failTask("parent-1");
      vi.spyOn(taskService, "reparentTask");

      fireEvent({ type: "task.updated", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      expect(taskService.reparentTask).toHaveBeenCalledWith("child-1", "grandparent-1");
    });

    it("ignores non-terminal task.updated events", async () => {
      insertTaskHierarchy();
      // parent-1 has default status "not_started" — not terminal
      vi.spyOn(taskService, "reparentTask");

      fireEvent({ type: "task.updated", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      expect(taskService.reparentTask).not.toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("ignores non-task events", async () => {
      vi.spyOn(taskStore, "getTask");

      fireEvent({ type: "workspace.created" as never, payload: { workspaceId: "ws-1" } });
      await flush();

      expect(taskStore.getTask).not.toHaveBeenCalled();
    });

    it("reparents to ROOT_TASK_ID when parent has no grandparent", async () => {
      // Create a root-level parent with children (no grandparent)
      taskStore.insertTask({
        id: "root-parent",
        workspaceId: "ws-1",
        title: "Root Parent",
        description: "",
        branch: "ws-1/root-parent",
        dependsOn: [],
        parentTaskId: "",
        depth: 0,
        canDecompose: true,
        injectKnowledge: true,
        defaultPersonaId: "",
        tokenBudget: 0,
        costBudgetMillicents: 0,
      });
      taskStore.insertTask({
        id: "orphan-child",
        workspaceId: "ws-1",
        title: "Orphan",
        description: "",
        branch: "ws-1/orphan",
        dependsOn: [],
        parentTaskId: "root-parent",
        depth: 1,
        canDecompose: false,
        injectKnowledge: true,
        defaultPersonaId: "",
        tokenBudget: 0,
        costBudgetMillicents: 0,
      });
      completeTask("root-parent");
      vi.spyOn(taskService, "reparentTask");

      fireEvent({
        type: "task.completed",
        payload: { taskId: "root-parent", workspaceId: "ws-1" },
      });
      await flush();

      expect(taskService.reparentTask).toHaveBeenCalledWith("orphan-child", "system");
    });

    it("does not reparent twice for the same parent (deduplication)", async () => {
      insertTaskHierarchy();
      completeTask("parent-1");
      vi.spyOn(taskService, "reparentTask");

      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      // Children reparented once (2 children), not twice
      expect(taskService.reparentTask).toHaveBeenCalledTimes(2);
    });

    it("logs errors but does not throw", async () => {
      insertTaskHierarchy();
      completeTask("parent-1");
      vi.spyOn(taskService, "getOrphanedTasks").mockImplementationOnce(() => {
        throw new Error("DB error");
      });

      // Should not throw
      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      // No assertion needed — just verifying no throw
    });

    it("continues reparenting remaining children if one fails", async () => {
      insertTaskHierarchy();
      completeTask("parent-1");
      vi.spyOn(taskService, "reparentTask")
        .mockImplementationOnce(() => {
          throw new Error("fail first");
        })
        .mockImplementationOnce(() => {});

      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      // Second child should still be attempted
      expect(taskService.reparentTask).toHaveBeenCalledTimes(2);
    });

    it("skips ROOT_TASK_ID as parent", async () => {
      vi.spyOn(taskService, "getOrphanedTasks");

      fireEvent({ type: "task.completed", payload: { taskId: "system", workspaceId: "ws-1" } });
      await flush();

      expect(taskService.getOrphanedTasks).not.toHaveBeenCalled();
    });
  });

  describe("pipe fd transfer", () => {
    it("transfers pipe subscriptions from dead parent to grandparent session", async () => {
      insertTaskHierarchy();
      completeTask("parent-1");

      // Insert sessions for parent and grandparent
      sessionStore.createSession(
        "parent-sess",
        "env-1",
        "stub",
        "",
        "claude",
        "/tmp/log",
        "parent-1",
      );
      sessionStore.updateSession("parent-sess", "stopped" as never);
      sessionStore.createSession(
        "gp-sess",
        "env-1",
        "stub",
        "",
        "claude",
        "/tmp/log",
        "grandparent-1",
      );
      sessionStore.updateSession("gp-sess", "idle" as never);

      // Parent session has a pipe subscription (streamRegistry is mocked from @grackle-ai/core)
      vi.mocked(streamRegistry.getSubscriptionsForSession).mockReturnValue([
        {
          id: "sub-1",
          streamId: "stream-1",
          sessionId: "parent-sess",
          fd: 3,
          permission: "rw",
          deliveryMode: "async",
          createdBySpawn: true,
        },
      ] as never);
      vi.mocked(streamRegistry.getStream).mockReturnValue({
        id: "stream-1",
        name: "pipe:child-sess-1",
        subscriptions: new Map(),
      } as never);

      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      // Should create subscription for grandparent
      expect(streamRegistry.subscribe).toHaveBeenCalledWith(
        "stream-1",
        "gp-sess",
        "rw",
        "async",
        true,
      );
      // Should remove dead parent's subscription
      expect(streamRegistry.unsubscribe).toHaveBeenCalledWith("sub-1");
      // Should set up async listener
      expect(ensureAsyncDeliveryListener).toHaveBeenCalledWith("gp-sess");
    });

    it("transfers pipe subscriptions even when no orphaned tasks exist", async () => {
      // Parent with no children — grandparent must exist first for FK
      taskStore.insertTask({
        id: "grandparent-1",
        workspaceId: "ws-1",
        title: "GP",
        description: "",
        branch: "ws-1/gp",
        dependsOn: [],
        parentTaskId: "",
        depth: 0,
        canDecompose: true,
        injectKnowledge: true,
        defaultPersonaId: "",
        tokenBudget: 0,
        costBudgetMillicents: 0,
      });
      taskStore.insertTask({
        id: "pipe-only-parent",
        workspaceId: "ws-1",
        title: "Pipe Parent",
        description: "",
        branch: "ws-1/pipe-parent",
        dependsOn: [],
        parentTaskId: "grandparent-1",
        depth: 1,
        canDecompose: false,
        injectKnowledge: true,
        defaultPersonaId: "",
        tokenBudget: 0,
        costBudgetMillicents: 0,
      });
      completeTask("pipe-only-parent");

      sessionStore.createSession(
        "parent-sess-only",
        "env-1",
        "stub",
        "",
        "claude",
        "/tmp/log",
        "pipe-only-parent",
      );
      sessionStore.updateSession("parent-sess-only", "idle" as never);
      sessionStore.createSession(
        "gp-sess-only",
        "env-1",
        "stub",
        "",
        "claude",
        "/tmp/log",
        "grandparent-1",
      );
      sessionStore.updateSession("gp-sess-only", "idle" as never);

      vi.mocked(streamRegistry.getSubscriptionsForSession).mockReturnValue([
        {
          id: "sub-only",
          streamId: "stream-only",
          sessionId: "parent-sess-only",
          fd: 3,
          permission: "rw",
          deliveryMode: "async",
          createdBySpawn: true,
        },
      ] as never);
      vi.mocked(streamRegistry.getStream).mockReturnValue({
        id: "stream-only",
        name: "pipe:child-sess-only",
        subscriptions: new Map(),
      } as never);

      vi.spyOn(taskService, "reparentTask");

      fireEvent({
        type: "task.completed",
        payload: { taskId: "pipe-only-parent", workspaceId: "ws-1" },
      });
      await flush();

      // Pipe should be transferred even though no tasks were reparented
      expect(streamRegistry.subscribe).toHaveBeenCalledWith(
        "stream-only",
        "gp-sess-only",
        "rw",
        "async",
        true,
      );
      expect(streamRegistry.unsubscribe).toHaveBeenCalledWith("sub-only");
      expect(taskService.reparentTask).not.toHaveBeenCalled();
    });

    it("skips non-pipe subscriptions (lifecycle streams)", async () => {
      taskStore.insertTask({
        id: "grandparent-1",
        workspaceId: "ws-1",
        title: "GP",
        description: "",
        branch: "ws-1/gp",
        dependsOn: [],
        parentTaskId: "",
        depth: 0,
        canDecompose: true,
        injectKnowledge: true,
        defaultPersonaId: "",
        tokenBudget: 0,
        costBudgetMillicents: 0,
      });
      taskStore.insertTask({
        id: "pipe-lifecycle-parent",
        workspaceId: "ws-1",
        title: "LC Parent",
        description: "",
        branch: "ws-1/lc-parent",
        dependsOn: [],
        parentTaskId: "grandparent-1",
        depth: 1,
        canDecompose: false,
        injectKnowledge: true,
        defaultPersonaId: "",
        tokenBudget: 0,
        costBudgetMillicents: 0,
      });
      completeTask("pipe-lifecycle-parent");

      sessionStore.createSession(
        "lc-sess",
        "env-1",
        "stub",
        "",
        "claude",
        "/tmp/log",
        "pipe-lifecycle-parent",
      );
      sessionStore.updateSession("lc-sess", "idle" as never);
      sessionStore.createSession(
        "gp-lc-sess",
        "env-1",
        "stub",
        "",
        "claude",
        "/tmp/log",
        "grandparent-1",
      );
      sessionStore.updateSession("gp-lc-sess", "idle" as never);

      // Parent session has ONLY a lifecycle subscription (no pipe:*)
      vi.mocked(streamRegistry.getSubscriptionsForSession).mockReturnValue([
        {
          id: "lc-sub",
          streamId: "lc-stream",
          sessionId: "lc-sess",
          fd: 1,
          permission: "rw",
          deliveryMode: "detach",
          createdBySpawn: true,
        },
      ] as never);
      vi.mocked(streamRegistry.getStream).mockReturnValue({
        id: "lc-stream",
        name: "lifecycle:some-session",
        subscriptions: new Map(),
      } as never);

      fireEvent({
        type: "task.completed",
        payload: { taskId: "pipe-lifecycle-parent", workspaceId: "ws-1" },
      });
      await flush();

      // Should NOT transfer lifecycle subscriptions
      expect(streamRegistry.subscribe).not.toHaveBeenCalled();
      expect(streamRegistry.unsubscribe).not.toHaveBeenCalled();
    });

    it("transfers multiple pipe subs across multiple parent sessions", async () => {
      taskStore.insertTask({
        id: "grandparent-1",
        workspaceId: "ws-1",
        title: "GP",
        description: "",
        branch: "ws-1/gp",
        dependsOn: [],
        parentTaskId: "",
        depth: 0,
        canDecompose: true,
        injectKnowledge: true,
        defaultPersonaId: "",
        tokenBudget: 0,
        costBudgetMillicents: 0,
      });
      taskStore.insertTask({
        id: "multi-pipe-parent",
        workspaceId: "ws-1",
        title: "Multi Parent",
        description: "",
        branch: "ws-1/multi-parent",
        dependsOn: [],
        parentTaskId: "grandparent-1",
        depth: 1,
        canDecompose: false,
        injectKnowledge: true,
        defaultPersonaId: "",
        tokenBudget: 0,
        costBudgetMillicents: 0,
      });
      completeTask("multi-pipe-parent");

      // Parent has TWO sessions (e.g., restarted task)
      sessionStore.createSession(
        "sess-a",
        "env-1",
        "stub",
        "",
        "claude",
        "/tmp/log",
        "multi-pipe-parent",
      );
      sessionStore.updateSession("sess-a", "stopped" as never);
      sessionStore.createSession(
        "sess-b",
        "env-1",
        "stub",
        "",
        "claude",
        "/tmp/log",
        "multi-pipe-parent",
      );
      sessionStore.updateSession("sess-b", "idle" as never);
      sessionStore.createSession(
        "gp-multi-sess",
        "env-1",
        "stub",
        "",
        "claude",
        "/tmp/log",
        "grandparent-1",
      );
      sessionStore.updateSession("gp-multi-sess", "idle" as never);

      // Each session has a pipe subscription
      vi.mocked(streamRegistry.getSubscriptionsForSession)
        .mockReturnValueOnce([
          {
            id: "sub-a",
            streamId: "stream-a",
            sessionId: "sess-a",
            fd: 3,
            permission: "rw",
            deliveryMode: "async",
            createdBySpawn: true,
          },
        ] as never)
        .mockReturnValueOnce([
          {
            id: "sub-b",
            streamId: "stream-b",
            sessionId: "sess-b",
            fd: 4,
            permission: "rw",
            deliveryMode: "sync",
            createdBySpawn: true,
          },
        ] as never);
      vi.mocked(streamRegistry.getStream)
        .mockReturnValueOnce({
          id: "stream-a",
          name: "pipe:child-a",
          subscriptions: new Map(),
        } as never)
        .mockReturnValueOnce({
          id: "stream-b",
          name: "pipe:child-b",
          subscriptions: new Map(),
        } as never);

      fireEvent({
        type: "task.completed",
        payload: { taskId: "multi-pipe-parent", workspaceId: "ws-1" },
      });
      await flush();

      // Both pipe subs should be transferred
      expect(streamRegistry.subscribe).toHaveBeenCalledTimes(2);
      expect(streamRegistry.subscribe).toHaveBeenCalledWith(
        "stream-a",
        "gp-multi-sess",
        "rw",
        "async",
        true,
      );
      expect(streamRegistry.subscribe).toHaveBeenCalledWith(
        "stream-b",
        "gp-multi-sess",
        "rw",
        "sync",
        true,
      );
      expect(streamRegistry.unsubscribe).toHaveBeenCalledWith("sub-a");
      expect(streamRegistry.unsubscribe).toHaveBeenCalledWith("sub-b");
    });

    it("continues transferring remaining subs if one fails", async () => {
      taskStore.insertTask({
        id: "grandparent-1",
        workspaceId: "ws-1",
        title: "GP",
        description: "",
        branch: "ws-1/gp",
        dependsOn: [],
        parentTaskId: "",
        depth: 0,
        canDecompose: true,
        injectKnowledge: true,
        defaultPersonaId: "",
        tokenBudget: 0,
        costBudgetMillicents: 0,
      });
      taskStore.insertTask({
        id: "fail-pipe-parent",
        workspaceId: "ws-1",
        title: "Fail Parent",
        description: "",
        branch: "ws-1/fail-parent",
        dependsOn: [],
        parentTaskId: "grandparent-1",
        depth: 1,
        canDecompose: false,
        injectKnowledge: true,
        defaultPersonaId: "",
        tokenBudget: 0,
        costBudgetMillicents: 0,
      });
      completeTask("fail-pipe-parent");

      sessionStore.createSession(
        "fail-sess",
        "env-1",
        "stub",
        "",
        "claude",
        "/tmp/log",
        "fail-pipe-parent",
      );
      sessionStore.updateSession("fail-sess", "idle" as never);
      sessionStore.createSession(
        "gp-fail-sess",
        "env-1",
        "stub",
        "",
        "claude",
        "/tmp/log",
        "grandparent-1",
      );
      sessionStore.updateSession("gp-fail-sess", "idle" as never);

      // Two pipe subscriptions — first transfer will throw
      vi.mocked(streamRegistry.getSubscriptionsForSession).mockReturnValue([
        {
          id: "fail-sub-1",
          streamId: "fail-stream-1",
          sessionId: "fail-sess",
          fd: 3,
          permission: "rw",
          deliveryMode: "async",
          createdBySpawn: true,
        },
        {
          id: "fail-sub-2",
          streamId: "fail-stream-2",
          sessionId: "fail-sess",
          fd: 4,
          permission: "rw",
          deliveryMode: "async",
          createdBySpawn: true,
        },
      ] as never);
      vi.mocked(streamRegistry.getStream)
        .mockReturnValueOnce({
          id: "fail-stream-1",
          name: "pipe:child-fail-1",
          subscriptions: new Map(),
        } as never)
        .mockReturnValueOnce({
          id: "fail-stream-2",
          name: "pipe:child-fail-2",
          subscriptions: new Map(),
        } as never);

      // First subscribe call throws, second succeeds
      vi.mocked(streamRegistry.subscribe)
        .mockImplementationOnce(() => {
          throw new Error("subscribe boom");
        })
        .mockReturnValueOnce({} as never);

      fireEvent({
        type: "task.completed",
        payload: { taskId: "fail-pipe-parent", workspaceId: "ws-1" },
      });
      await flush();

      // Second sub should still be attempted despite first failure
      expect(streamRegistry.subscribe).toHaveBeenCalledTimes(2);
      expect(streamRegistry.unsubscribe).toHaveBeenCalledWith("fail-sub-2");
    });

    it("skips transfer when no grandparent session is active", async () => {
      insertTaskHierarchy();
      completeTask("parent-1");
      // No active sessions for grandparent

      vi.mocked(streamRegistry.subscribe).mockReset();

      fireEvent({ type: "task.completed", payload: { taskId: "parent-1", workspaceId: "ws-1" } });
      await flush();

      // Should NOT try to create subscriptions
      expect(streamRegistry.subscribe).not.toHaveBeenCalled();
    });
  });
});
