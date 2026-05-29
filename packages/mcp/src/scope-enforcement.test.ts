import { describe, test, expect, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { ROOT_TASK_ID, type grackle } from "@grackle-ai/common";
import type { AuthContext } from "@grackle-ai/auth";
import {
  assertCallerIsAncestor,
  assertCallerIsSelfOrAncestor,
  enforceToolScope,
  enforceReadMembership,
} from "./scope-enforcement.js";
import type { GrackleClients, ToolDefinition, ToolScope } from "./tool-registry.js";

type GrackleClient = Client<typeof grackle.GrackleOrchestration>;

/** Build a mock client whose getTask returns tasks from a lookup table. */
function createMockClient(tasks: Record<string, { parentTaskId: string }>): GrackleClient {
  return {
    getTask: vi.fn().mockImplementation(({ id }: { id: string }) => {
      const task = tasks[id];
      if (!task) {
        throw new ConnectError("not found", Code.NotFound);
      }
      return Promise.resolve({ id, ...task });
    }),
  } as unknown as GrackleClient;
}

const SCOPED_AUTH: AuthContext = {
  type: "scoped",
  taskId: "parent-task",
  workspaceId: "proj-1",
  personaId: "p-1",
  taskSessionId: "sess-1",
};

describe("assertCallerIsAncestor", () => {
  test("no-op for undefined auth", async () => {
    const client = createMockClient({});
    await expect(assertCallerIsAncestor(client, undefined, "any-task")).resolves.toBeUndefined();
    expect(client.getTask).not.toHaveBeenCalled();
  });

  test("no-op for api-key auth", async () => {
    const client = createMockClient({});
    await expect(
      assertCallerIsAncestor(client, { type: "api-key" }, "any-task"),
    ).resolves.toBeUndefined();
    expect(client.getTask).not.toHaveBeenCalled();
  });

  test("no-op for oauth auth", async () => {
    const client = createMockClient({});
    await expect(
      assertCallerIsAncestor(client, { type: "oauth", clientId: "c1" }, "any-task"),
    ).resolves.toBeUndefined();
    expect(client.getTask).not.toHaveBeenCalled();
  });

  test("passes when target's parent is the caller", async () => {
    const client = createMockClient({
      "child-task": { parentTaskId: "parent-task" },
    });
    await expect(
      assertCallerIsAncestor(client, SCOPED_AUTH, "child-task"),
    ).resolves.toBeUndefined();
  });

  test("passes when target's grandparent is the caller", async () => {
    const client = createMockClient({
      grandchild: { parentTaskId: "child-task" },
      "child-task": { parentTaskId: "parent-task" },
    });
    await expect(
      assertCallerIsAncestor(client, SCOPED_AUTH, "grandchild"),
    ).resolves.toBeUndefined();
  });

  test("rejects when target is the caller's own task", async () => {
    const client = createMockClient({});
    await expect(assertCallerIsAncestor(client, SCOPED_AUTH, "parent-task")).rejects.toThrow(
      ConnectError,
    );
    await expect(assertCallerIsAncestor(client, SCOPED_AUTH, "parent-task")).rejects.toThrow(
      "Cannot operate on your own task",
    );
  });

  test("rejects when target is not a descendant", async () => {
    const client = createMockClient({
      "unrelated-task": { parentTaskId: "other-root" },
      "other-root": { parentTaskId: "" },
    });
    await expect(assertCallerIsAncestor(client, SCOPED_AUTH, "unrelated-task")).rejects.toThrow(
      ConnectError,
    );
    await expect(assertCallerIsAncestor(client, SCOPED_AUTH, "unrelated-task")).rejects.toThrow(
      "not a descendant",
    );
  });

  test("rejects when target is a root task (no parent)", async () => {
    const client = createMockClient({
      "root-task": { parentTaskId: "" },
    });
    await expect(assertCallerIsAncestor(client, SCOPED_AUTH, "root-task")).rejects.toThrow(
      ConnectError,
    );
  });
});

describe("assertCallerIsSelfOrAncestor", () => {
  test("no-op for non-scoped auth", async () => {
    const client = createMockClient({});
    await expect(
      assertCallerIsSelfOrAncestor(client, undefined, "any-task"),
    ).resolves.toBeUndefined();
    await expect(
      assertCallerIsSelfOrAncestor(client, { type: "api-key" }, "any-task"),
    ).resolves.toBeUndefined();
  });

  test("allows self-access (target === caller task)", async () => {
    const client = createMockClient({});
    await expect(
      assertCallerIsSelfOrAncestor(client, SCOPED_AUTH, "parent-task"),
    ).resolves.toBeUndefined();
    expect(client.getTask).not.toHaveBeenCalled();
  });

  test("allows descendant access", async () => {
    const client = createMockClient({
      "child-task": { parentTaskId: "parent-task" },
    });
    await expect(
      assertCallerIsSelfOrAncestor(client, SCOPED_AUTH, "child-task"),
    ).resolves.toBeUndefined();
  });

  test("rejects unrelated task", async () => {
    const client = createMockClient({
      "unrelated-task": { parentTaskId: "other-root" },
      "other-root": { parentTaskId: "" },
    });
    await expect(
      assertCallerIsSelfOrAncestor(client, SCOPED_AUTH, "unrelated-task"),
    ).rejects.toThrow(ConnectError);
    await expect(
      assertCallerIsSelfOrAncestor(client, SCOPED_AUTH, "unrelated-task"),
    ).rejects.toThrow("not self or a descendant");
  });
});

describe("enforceToolScope", () => {
  /** Build a GrackleClients stub with task ancestry + session→task lookups. */
  function createClients(
    tasks: Record<string, { parentTaskId: string }>,
    sessions: Record<string, { taskId: string }> = {},
  ): GrackleClients {
    return {
      orchestration: createMockClient(tasks),
      core: {
        getSession: vi.fn().mockImplementation(({ id }: { id: string }) => {
          const session = sessions[id];
          if (!session) {
            throw new ConnectError("not found", Code.NotFound);
          }
          return Promise.resolve({ id, taskId: session.taskId });
        }),
      },
    } as unknown as GrackleClients;
  }

  /** Build a minimal tool definition carrying only the scope descriptor. */
  function toolWithScope(scope: ToolScope | undefined): ToolDefinition {
    return { name: "t", group: "g", description: "d", scope } as unknown as ToolDefinition;
  }

  const TASK_TOOL = toolWithScope({ taskIdArg: "taskId" });
  const SESSION_TOOL = toolWithScope({ sessionIdArg: "sessionId" });

  test("no-op for non-scoped auth", async () => {
    const clients = createClients({});
    await expect(
      enforceToolScope(clients, TASK_TOOL, { type: "api-key" }, { taskId: "anything" }),
    ).resolves.toBeUndefined();
    await expect(
      enforceToolScope(clients, TASK_TOOL, undefined, { taskId: "anything" }),
    ).resolves.toBeUndefined();
    expect(clients.orchestration.getTask).not.toHaveBeenCalled();
  });

  test("no-op for the root/system task (full access)", async () => {
    const clients = createClients({});
    const rootAuth: AuthContext = {
      type: "scoped",
      taskId: ROOT_TASK_ID,
      workspaceId: "proj-1",
      personaId: "p",
      taskSessionId: "s",
    };
    await expect(
      enforceToolScope(clients, TASK_TOOL, rootAuth, { taskId: "any-victim" }),
    ).resolves.toBeUndefined();
    expect(clients.orchestration.getTask).not.toHaveBeenCalled();
  });

  test("no-op when the tool has no scope descriptor", async () => {
    const clients = createClients({});
    await expect(
      enforceToolScope(clients, toolWithScope(undefined), SCOPED_AUTH, { taskId: "x" }),
    ).resolves.toBeUndefined();
    expect(clients.orchestration.getTask).not.toHaveBeenCalled();
  });

  test("taskIdArg: allows a descendant target", async () => {
    const clients = createClients({ "child-task": { parentTaskId: "parent-task" } });
    await expect(
      enforceToolScope(clients, TASK_TOOL, SCOPED_AUTH, { taskId: "child-task" }),
    ).resolves.toBeUndefined();
  });

  test("taskIdArg: denies an unrelated target", async () => {
    const clients = createClients({
      "victim-task": { parentTaskId: "other-root" },
      "other-root": { parentTaskId: "" },
    });
    await expect(
      enforceToolScope(clients, TASK_TOOL, SCOPED_AUTH, { taskId: "victim-task" }),
    ).rejects.toThrow("not a descendant");
  });

  test("taskIdArg: denies the caller's own task", async () => {
    const clients = createClients({});
    await expect(
      enforceToolScope(clients, TASK_TOOL, SCOPED_AUTH, { taskId: "parent-task" }),
    ).rejects.toThrow("Cannot operate on your own task");
  });

  test("missing/empty target arg is left to Zod (no lookup, no throw)", async () => {
    const clients = createClients({});
    await expect(enforceToolScope(clients, TASK_TOOL, SCOPED_AUTH, {})).resolves.toBeUndefined();
    await expect(
      enforceToolScope(clients, TASK_TOOL, SCOPED_AUTH, { taskId: "" }),
    ).resolves.toBeUndefined();
    expect(clients.orchestration.getTask).not.toHaveBeenCalled();
  });

  test("sessionIdArg: resolves session→task then allows a descendant", async () => {
    const clients = createClients(
      { "child-task": { parentTaskId: "parent-task" } },
      { "sess-x": { taskId: "child-task" } },
    );
    await expect(
      enforceToolScope(clients, SESSION_TOOL, SCOPED_AUTH, { sessionId: "sess-x" }),
    ).resolves.toBeUndefined();
    expect(clients.core.getSession).toHaveBeenCalledWith({ id: "sess-x" });
  });

  test("sessionIdArg: denies a session owned by an unrelated task", async () => {
    const clients = createClients(
      { "victim-task": { parentTaskId: "other-root" }, "other-root": { parentTaskId: "" } },
      { "sess-y": { taskId: "victim-task" } },
    );
    await expect(
      enforceToolScope(clients, SESSION_TOOL, SCOPED_AUTH, { sessionId: "sess-y" }),
    ).rejects.toThrow("not a descendant");
  });

  test("sessionIdArg: rejects a taskless session", async () => {
    const clients = createClients({}, { "sess-z": { taskId: "" } });
    await expect(
      enforceToolScope(clients, SESSION_TOOL, SCOPED_AUTH, { sessionId: "sess-z" }),
    ).rejects.toThrow("taskless session");
  });
});

describe("enforceReadMembership", () => {
  /** Build a GrackleClients stub with task + schedule workspace lookups. */
  function createClients(
    tasks: Record<string, { workspaceId: string }> = {},
    schedules: Record<string, { workspaceId: string }> = {},
  ): GrackleClients {
    return {
      orchestration: {
        getTask: vi.fn().mockImplementation(({ id }: { id: string }) => {
          const task = tasks[id];
          if (!task) {
            throw new ConnectError("not found", Code.NotFound);
          }
          return Promise.resolve({ id, workspaceId: task.workspaceId });
        }),
      },
      scheduling: {
        getSchedule: vi.fn().mockImplementation(({ id }: { id: string }) => {
          const schedule = schedules[id];
          if (!schedule) {
            throw new ConnectError("not found", Code.NotFound);
          }
          return Promise.resolve({ id, workspaceId: schedule.workspaceId });
        }),
      },
    } as unknown as GrackleClients;
  }

  /** A scoped caller bound to no workspace (`pid: ""` → workspaceId undefined). */
  const WORKSPACELESS_AUTH: AuthContext = {
    type: "scoped",
    taskId: "lone-task",
    workspaceId: undefined,
    personaId: "p",
    taskSessionId: "s",
  };

  test("no-op for non-scoped auth", async () => {
    const clients = createClients({ t1: { workspaceId: "other" } });
    await expect(
      enforceReadMembership(clients, "task_show", { type: "api-key" }, { taskId: "t1" }),
    ).resolves.toBeUndefined();
    expect(clients.orchestration.getTask).not.toHaveBeenCalled();
  });

  test("no-op for the root/system task", async () => {
    const clients = createClients({ t1: { workspaceId: "other" } });
    const rootAuth: AuthContext = {
      type: "scoped",
      taskId: ROOT_TASK_ID,
      workspaceId: undefined,
      personaId: "p",
      taskSessionId: "s",
    };
    await expect(
      enforceReadMembership(clients, "task_show", rootAuth, { taskId: "t1" }),
    ).resolves.toBeUndefined();
    expect(clients.orchestration.getTask).not.toHaveBeenCalled();
  });

  test("no-op for a non-membership-gated tool", async () => {
    const clients = createClients();
    await expect(
      enforceReadMembership(clients, "task_list", SCOPED_AUTH, {}),
    ).resolves.toBeUndefined();
    expect(clients.orchestration.getTask).not.toHaveBeenCalled();
  });

  test("task_show: allows a same-workspace task", async () => {
    const clients = createClients({ t1: { workspaceId: "proj-1" } });
    await expect(
      enforceReadMembership(clients, "task_show", SCOPED_AUTH, { taskId: "t1" }),
    ).resolves.toBeUndefined();
  });

  test("task_show: denies a cross-workspace task", async () => {
    const clients = createClients({ t1: { workspaceId: "proj-2" } });
    await expect(
      enforceReadMembership(clients, "task_show", SCOPED_AUTH, { taskId: "t1" }),
    ).rejects.toThrow("different workspace");
  });

  test("task_show: workspaceless caller is denied a workspace-bound task (F7)", async () => {
    const clients = createClients({ t1: { workspaceId: "proj-1" } });
    await expect(
      enforceReadMembership(clients, "task_show", WORKSPACELESS_AUTH, { taskId: "t1" }),
    ).rejects.toThrow("different workspace");
  });

  test("task_show: workspaceless caller may read a workspaceless task", async () => {
    const clients = createClients({ t1: { workspaceId: "" } });
    await expect(
      enforceReadMembership(clients, "task_show", WORKSPACELESS_AUTH, { taskId: "t1" }),
    ).resolves.toBeUndefined();
  });

  test("schedule_show: denies a cross-workspace schedule", async () => {
    const clients = createClients({}, { sch1: { workspaceId: "proj-2" } });
    await expect(
      enforceReadMembership(clients, "schedule_show", SCOPED_AUTH, { scheduleId: "sch1" }),
    ).rejects.toThrow("different workspace");
  });

  test("schedule_show: allows a same-workspace schedule", async () => {
    const clients = createClients({}, { sch1: { workspaceId: "proj-1" } });
    await expect(
      enforceReadMembership(clients, "schedule_show", SCOPED_AUTH, { scheduleId: "sch1" }),
    ).resolves.toBeUndefined();
  });

  test("missing/empty id is left to Zod (no lookup, no throw)", async () => {
    const clients = createClients();
    await expect(
      enforceReadMembership(clients, "task_show", SCOPED_AUTH, {}),
    ).resolves.toBeUndefined();
    await expect(
      enforceReadMembership(clients, "schedule_show", SCOPED_AUTH, { scheduleId: "" }),
    ).resolves.toBeUndefined();
    expect(clients.orchestration.getTask).not.toHaveBeenCalled();
    expect(clients.scheduling.getSchedule).not.toHaveBeenCalled();
  });
});
