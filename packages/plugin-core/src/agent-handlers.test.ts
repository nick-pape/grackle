import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the database layer used by the agent handlers.
const mockDb: {
  agents: Map<string, Record<string, unknown>>;
  environments: Map<string, Record<string, unknown>>;
  /** Tasks owned by an agent, keyed by agentId. */
  agentTasks: Map<string, Array<Record<string, unknown>>>;
  /** Sessions belonging to a task, keyed by taskId. */
  taskSessions: Map<string, Array<Record<string, unknown>>>;
  /** Tasks that have been deleted via deleteTask, for assertions. */
  deletedTaskIds: string[];
  /** Root tasks owned by agents, keyed by agentId. */
  agentRootTasks: Map<string, Record<string, unknown>>;
  /** Schedules keyed by schedule id. */
  schedules: Map<string, Record<string, unknown>>;
} = {
  agents: new Map(),
  environments: new Map([["local", { id: "local", displayName: "Local" }]]),
  agentTasks: new Map(),
  taskSessions: new Map(),
  deletedTaskIds: [],
  agentRootTasks: new Map(),
  schedules: new Map(),
};

vi.mock("@grackle-ai/database", () => ({
  agentStore: {
    listAgents: (): Array<Record<string, unknown>> =>
      [...mockDb.agents.values()].sort((a, b) =>
        (a as { name: string }).name.localeCompare((b as { name: string }).name),
      ),
    getAgent: (id: string): Record<string, unknown> | undefined => mockDb.agents.get(id),
    getAgentByName: (name: string): Record<string, unknown> | undefined =>
      [...mockDb.agents.values()].find((a) => (a as { name: string }).name === name),
    createAgent: (
      id: string,
      name: string,
      avatar: string,
      primaryPersonaId: string,
      environmentId: string,
    ): void => {
      mockDb.agents.set(id, {
        id,
        name,
        avatar,
        primaryPersonaId,
        environmentId,
        createdAt: "2024-01-01",
        updatedAt: "2024-01-01",
      });
    },
    updateAgent: (
      id: string,
      fields: { name?: string; avatar?: string; primaryPersonaId?: string },
    ): void => {
      const existing = mockDb.agents.get(id);
      if (existing) {
        mockDb.agents.set(id, {
          ...existing,
          name: fields.name ?? (existing as { name: string }).name,
          avatar: fields.avatar ?? (existing as { avatar: string }).avatar,
          primaryPersonaId:
            fields.primaryPersonaId ?? (existing as { primaryPersonaId: string }).primaryPersonaId,
        });
      }
    },
    deleteAgent: (id: string): void => {
      mockDb.agents.delete(id);
    },
  },
  envRegistry: {
    getEnvironment: (id: string): Record<string, unknown> | undefined =>
      mockDb.environments.get(id),
  },
  sessionStore: {
    listSessionsForTask: (taskId: string): Array<Record<string, unknown>> =>
      mockDb.taskSessions.get(taskId) ?? [],
  },
  taskStore: {
    getTasksForAgent: (agentId: string): Array<Record<string, unknown>> =>
      mockDb.agentTasks.get(agentId) ?? [],
    deleteTask: (id: string): void => {
      mockDb.deletedTaskIds.push(id);
    },
    getRootTaskForAgent: (agentId: string): Record<string, unknown> | undefined =>
      mockDb.agentRootTasks.get(agentId),
  },
  scheduleStore: {
    getSchedule: (id: string): Record<string, unknown> | undefined => mockDb.schedules.get(id),
    getHeartbeatForTask: (taskId: string): Record<string, unknown> | undefined => {
      for (const s of mockDb.schedules.values()) {
        if ((s as { taskId: string | null }).taskId === taskId) {
          return s;
        }
      }
      return undefined;
    },
    createSchedule: (
      id: string,
      title: string,
      description: string,
      scheduleExpression: string,
      personaId: string,
      workspaceId: string,
      parentTaskId: string,
      nextRunAt: string | null,
      taskId: string | null = null,
    ): void => {
      // Mirror partial-unique behavior of the real DB.
      if (taskId !== null) {
        for (const s of mockDb.schedules.values()) {
          if ((s as { taskId: string | null }).taskId === taskId) {
            throw new Error("UNIQUE constraint failed: schedules.task_id");
          }
        }
      }
      mockDb.schedules.set(id, {
        id,
        title,
        description,
        scheduleExpression,
        personaId,
        workspaceId,
        parentTaskId,
        enabled: true,
        lastRunAt: null,
        nextRunAt,
        runCount: 0,
        taskId,
        createdAt: "2024-01-01",
        updatedAt: "2024-01-01",
      });
    },
    updateSchedule: (
      id: string,
      fields: {
        scheduleExpression?: string;
        description?: string;
        enabled?: boolean;
        nextRunAt?: string | null;
      },
    ): void => {
      const existing = mockDb.schedules.get(id);
      if (!existing) return;
      mockDb.schedules.set(id, {
        ...existing,
        ...(fields.scheduleExpression !== undefined
          ? { scheduleExpression: fields.scheduleExpression }
          : {}),
        ...(fields.description !== undefined ? { description: fields.description } : {}),
        ...(fields.enabled !== undefined ? { enabled: fields.enabled } : {}),
        ...(fields.nextRunAt !== undefined ? { nextRunAt: fields.nextRunAt } : {}),
      });
    },
    deleteSchedule: (id: string): void => {
      mockDb.schedules.delete(id);
    },
  },
  slugify: (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
}));

// killSessionAndCleanup is imported from grpc-shared. Mock the module to
// record calls without pulling in the real streamHub / lifecycle plumbing.
const killSessionMock = vi.fn();
vi.mock("./grpc-shared.js", () => ({
  killSessionAndCleanup: (session: Record<string, unknown>): void => killSessionMock(session),
}));

const emitMock = vi.fn();
vi.mock("@grackle-ai/core", () => ({
  emit: (type: string, payload: unknown) => emitMock(type, payload),
}));

import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import * as agentHandlers from "./agent-handlers.js";

describe("agent-handlers", () => {
  beforeEach(() => {
    mockDb.agents.clear();
    mockDb.agentTasks.clear();
    mockDb.taskSessions.clear();
    mockDb.deletedTaskIds = [];
    mockDb.agentRootTasks.clear();
    mockDb.schedules.clear();
    emitMock.mockClear();
    killSessionMock.mockClear();
  });

  it("createAgent + listAgents round-trip and emits agent.created", async () => {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, {
        environmentId: "local",
        name: "Refactor Bot",
        avatar: "🐦",
        primaryPersonaId: "p1",
      }),
    );
    expect(created.name).toBe("Refactor Bot");
    expect(created.avatar).toBe("🐦");
    expect(created.primaryPersonaId).toBe("p1");
    expect(emitMock).toHaveBeenCalledWith("agent.created", expect.objectContaining({}));

    const list = await agentHandlers.listAgents();
    expect(list.agents).toHaveLength(1);
    expect(list.agents[0].name).toBe("Refactor Bot");
  });

  it("lists agents ordered by name", async () => {
    await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { environmentId: "local", name: "Zeta" }),
    );
    await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { environmentId: "local", name: "Alpha" }),
    );
    const list = await agentHandlers.listAgents();
    expect(list.agents.map((a) => a.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("getAgent returns a created agent", async () => {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { environmentId: "local", name: "Findable" }),
    );
    const got = await agentHandlers.getAgent(create(grackle.AgentIdSchema, { id: created.id }));
    expect(got.name).toBe("Findable");
  });

  it("getAgent throws NotFound for a missing agent", async () => {
    await expect(
      agentHandlers.getAgent(create(grackle.AgentIdSchema, { id: "nope" })),
    ).rejects.toThrow(/not found/i);
  });

  it("createAgent rejects a duplicate name", async () => {
    await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { environmentId: "local", name: "Dupe" }),
    );
    await expect(
      agentHandlers.createAgent(
        create(grackle.CreateAgentRequestSchema, { environmentId: "local", name: "Dupe" }),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it("updateAgent changes only provided fields and emits agent.updated", async () => {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, {
        environmentId: "local",
        name: "Before",
        avatar: "x",
        primaryPersonaId: "p1",
      }),
    );
    const updated = await agentHandlers.updateAgent(
      create(grackle.UpdateAgentRequestSchema, { id: created.id, name: "After" }),
    );
    expect(updated.name).toBe("After");
    // avatar left unset → preserved
    expect(updated.avatar).toBe("x");
    expect(emitMock).toHaveBeenCalledWith("agent.updated", expect.objectContaining({}));
  });

  it("deleteAgent removes the agent and emits agent.deleted", async () => {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { environmentId: "local", name: "Doomed" }),
    );
    await agentHandlers.deleteAgent(create(grackle.AgentIdSchema, { id: created.id }));
    expect(mockDb.agents.has(created.id)).toBe(false);
    expect(emitMock).toHaveBeenCalledWith("agent.deleted", expect.objectContaining({}));
  });

  it("createAgent trims whitespace from the name and stores the trimmed value", async () => {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { environmentId: "local", name: "  Trimmed  " }),
    );
    expect(created.name).toBe("Trimmed");
  });

  it("createAgent rejects a whitespace-only name", async () => {
    await expect(
      agentHandlers.createAgent(
        create(grackle.CreateAgentRequestSchema, { environmentId: "local", name: "   " }),
      ),
    ).rejects.toThrow(/name is required/i);
  });

  it("updateAgent rejects an explicitly-empty name (presence-tracked)", async () => {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { environmentId: "local", name: "Keep" }),
    );
    await expect(
      agentHandlers.updateAgent(
        create(grackle.UpdateAgentRequestSchema, { id: created.id, name: "" }),
      ),
    ).rejects.toThrow(/cannot be empty/i);
    await expect(
      agentHandlers.updateAgent(
        create(grackle.UpdateAgentRequestSchema, { id: created.id, name: "   " }),
      ),
    ).rejects.toThrow(/cannot be empty/i);
  });

  it("updateAgent rejects a request with no updatable fields", async () => {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { environmentId: "local", name: "NoOp" }),
    );
    await expect(
      agentHandlers.updateAgent(create(grackle.UpdateAgentRequestSchema, { id: created.id })),
    ).rejects.toThrow(/no updatable fields/i);
  });

  it("createAgent trims avatar and primaryPersonaId before storing", async () => {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, {
        environmentId: "local",
        name: "Trimmer",
        avatar: "   ",
        primaryPersonaId: "  claude-code  ",
      }),
    );
    // Whitespace-only avatar collapses to "" so the UI's monogram fallback fires.
    expect(created.avatar).toBe("");
    expect(created.primaryPersonaId).toBe("claude-code");
  });

  it("updateAgent trims avatar / primaryPersonaId; empty string clears, undefined preserves", async () => {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, {
        environmentId: "local",
        name: "Clearer",
        avatar: "X",
        primaryPersonaId: "p1",
      }),
    );

    // Whitespace-only avatar clears the avatar (presence-tracked + trim).
    const cleared = await agentHandlers.updateAgent(
      create(grackle.UpdateAgentRequestSchema, { id: created.id, avatar: "   " }),
    );
    expect(cleared.avatar).toBe("");
    // primaryPersonaId left unset (undefined) → preserved.
    expect(cleared.primaryPersonaId).toBe("p1");

    // Trim a value-carrying primaryPersonaId.
    const trimmed = await agentHandlers.updateAgent(
      create(grackle.UpdateAgentRequestSchema, {
        id: created.id,
        primaryPersonaId: "  p2  ",
      }),
    );
    expect(trimmed.primaryPersonaId).toBe("p2");
  });

  it("updateAgent trims the name and rejects a name colliding with another agent", async () => {
    await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { environmentId: "local", name: "Taken" }),
    );
    const other = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { environmentId: "local", name: "Other" }),
    );
    // Trimming applies before the duplicate check.
    await expect(
      agentHandlers.updateAgent(
        create(grackle.UpdateAgentRequestSchema, { id: other.id, name: "  Taken  " }),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  // ── #1418 — environment validation + cascade delete ─────────────────

  it("createAgent rejects an empty environment_id", async () => {
    await expect(
      agentHandlers.createAgent(
        create(grackle.CreateAgentRequestSchema, { name: "NoEnv", environmentId: "" }),
      ),
    ).rejects.toThrow(/environment_id is required/i);
  });

  it("createAgent rejects a whitespace-only environment_id", async () => {
    await expect(
      agentHandlers.createAgent(
        create(grackle.CreateAgentRequestSchema, { name: "BlankEnv", environmentId: "   " }),
      ),
    ).rejects.toThrow(/environment_id is required/i);
  });

  it("createAgent rejects an unknown environment id with NotFound", async () => {
    await expect(
      agentHandlers.createAgent(
        create(grackle.CreateAgentRequestSchema, {
          name: "Ghosted",
          environmentId: "does-not-exist",
        }),
      ),
    ).rejects.toThrow(/environment not found/i);
  });

  it("createAgent emits agent.created with environmentId in the payload", async () => {
    await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { name: "WithEnv", environmentId: "local" }),
    );
    expect(emitMock).toHaveBeenCalledWith(
      "agent.created",
      expect.objectContaining({ environmentId: "local" }),
    );
  });

  it("createAgent exposes environment_id on the returned proto", async () => {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { name: "WithEnv2", environmentId: "local" }),
    );
    expect(created.environmentId).toBe("local");
  });

  it("deleteAgent kills non-terminal sessions, deletes descendant tasks, then the agent", async () => {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { name: "Cascade", environmentId: "local" }),
    );
    // Seed the mock with a root task + one child task; the root has a live session.
    const rootTaskId = `${created.id}-root`;
    const childTaskId = `${created.id}-child`;
    mockDb.agentTasks.set(created.id, [
      { id: rootTaskId, kind: "root", agentId: created.id },
      { id: childTaskId, kind: "task", agentId: created.id, parentTaskId: rootTaskId },
    ]);
    mockDb.taskSessions.set(rootTaskId, [
      { id: "s-root-1", taskId: rootTaskId, status: "running" },
    ]);
    mockDb.taskSessions.set(childTaskId, []);

    await agentHandlers.deleteAgent(create(grackle.AgentIdSchema, { id: created.id }));

    // Live session got killed.
    expect(killSessionMock).toHaveBeenCalledTimes(1);
    expect(killSessionMock).toHaveBeenCalledWith(expect.objectContaining({ id: "s-root-1" }));
    // Both tasks deleted (in some order).
    expect(mockDb.deletedTaskIds.sort()).toEqual([childTaskId, rootTaskId].sort());
    // Agent row removed.
    expect(mockDb.agents.has(created.id)).toBe(false);
    // agent.deleted event fired.
    expect(emitMock).toHaveBeenCalledWith(
      "agent.deleted",
      expect.objectContaining({ agentId: created.id }),
    );
  });

  it("deleteAgent on an agent with no tasks is a no-op cascade", async () => {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { name: "Lonely", environmentId: "local" }),
    );
    // No agentTasks entry → getTasksForAgent returns [].
    await agentHandlers.deleteAgent(create(grackle.AgentIdSchema, { id: created.id }));
    expect(killSessionMock).not.toHaveBeenCalled();
    expect(mockDb.deletedTaskIds).toEqual([]);
    expect(mockDb.agents.has(created.id)).toBe(false);
  });

  // ── #1438 — Agent heartbeat ─────────────────────────────────────

  /** Seed an agent + its root task in the mock store. */
  async function createAgentWithRoot(name: string): Promise<{ id: string; rootTaskId: string }> {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, {
        environmentId: "local",
        name,
        primaryPersonaId: "p1",
      }),
    );
    const rootTaskId = `${created.id}-root`;
    mockDb.agentRootTasks.set(created.id, { id: rootTaskId, kind: "root", agentId: created.id });
    return { id: created.id, rootTaskId };
  }

  it("setAgentHeartbeat creates a schedule when none exists", async () => {
    const { id, rootTaskId } = await createAgentWithRoot("HB Create");
    const sched = await agentHandlers.setAgentHeartbeat(
      create(grackle.SetAgentHeartbeatRequestSchema, {
        agentId: id,
        cadence: "30s",
        rules: "wake up and check the queue",
        enabled: true,
      }),
    );
    expect(sched.scheduleExpression).toBe("30s");
    expect(sched.description).toBe("wake up and check the queue");
    expect(sched.enabled).toBe(true);
    // The created schedule targets the agent's root task.
    const stored = [...mockDb.schedules.values()][0] as { taskId: string };
    expect(stored.taskId).toBe(rootTaskId);
    expect(emitMock).toHaveBeenCalledWith(
      "agent.heartbeat.updated",
      expect.objectContaining({ agentId: id }),
    );
  });

  it("setAgentHeartbeat updates cadence on an existing schedule and preserves other fields", async () => {
    const { id } = await createAgentWithRoot("HB Update");
    await agentHandlers.setAgentHeartbeat(
      create(grackle.SetAgentHeartbeatRequestSchema, {
        agentId: id,
        cadence: "30s",
        rules: "original rules",
      }),
    );
    const updated = await agentHandlers.setAgentHeartbeat(
      create(grackle.SetAgentHeartbeatRequestSchema, { agentId: id, cadence: "1m" }),
    );
    expect(updated.scheduleExpression).toBe("1m");
    // Rules preserved (presence semantics: undefined = keep).
    expect(updated.description).toBe("original rules");
  });

  it("setAgentHeartbeat with empty cadence clears the schedule and emits agent.heartbeat.cleared", async () => {
    const { id } = await createAgentWithRoot("HB Clear");
    await agentHandlers.setAgentHeartbeat(
      create(grackle.SetAgentHeartbeatRequestSchema, { agentId: id, cadence: "30s", rules: "x" }),
    );
    expect(mockDb.schedules.size).toBe(1);
    const cleared = await agentHandlers.setAgentHeartbeat(
      create(grackle.SetAgentHeartbeatRequestSchema, { agentId: id, cadence: "" }),
    );
    expect(mockDb.schedules.size).toBe(0);
    // The returned proto is the empty Schedule (id stays unset).
    expect(cleared.id).toBe("");
    expect(emitMock).toHaveBeenCalledWith(
      "agent.heartbeat.cleared",
      expect.objectContaining({ agentId: id }),
    );
  });

  it("setAgentHeartbeat rejects an invalid cadence expression with InvalidArgument", async () => {
    const { id } = await createAgentWithRoot("HB Invalid");
    await expect(
      agentHandlers.setAgentHeartbeat(
        create(grackle.SetAgentHeartbeatRequestSchema, { agentId: id, cadence: "garbage" }),
      ),
    ).rejects.toThrow(/invalid|expression/i);
  });

  it("setAgentHeartbeat on an unknown agent throws NotFound", async () => {
    await expect(
      agentHandlers.setAgentHeartbeat(
        create(grackle.SetAgentHeartbeatRequestSchema, { agentId: "nope", cadence: "30s" }),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("setAgentHeartbeat without cadence and no existing schedule throws InvalidArgument", async () => {
    const { id } = await createAgentWithRoot("HB Bare");
    // No cadence + no existing → there is nothing to pause/edit.
    await expect(
      agentHandlers.setAgentHeartbeat(
        create(grackle.SetAgentHeartbeatRequestSchema, { agentId: id, enabled: false }),
      ),
    ).rejects.toThrow(/cadence/i);
  });

  it("setAgentHeartbeat can pause an existing heartbeat (enabled=false) without re-sending cadence", async () => {
    const { id } = await createAgentWithRoot("HB Pause");
    await agentHandlers.setAgentHeartbeat(
      create(grackle.SetAgentHeartbeatRequestSchema, { agentId: id, cadence: "30s", rules: "r" }),
    );
    const paused = await agentHandlers.setAgentHeartbeat(
      create(grackle.SetAgentHeartbeatRequestSchema, { agentId: id, enabled: false }),
    );
    expect(paused.enabled).toBe(false);
    expect(paused.scheduleExpression).toBe("30s");
  });

  it("getAgent embeds the heartbeat when a schedule exists for the agent's root task", async () => {
    const { id } = await createAgentWithRoot("HB Embedded");
    await agentHandlers.setAgentHeartbeat(
      create(grackle.SetAgentHeartbeatRequestSchema, {
        agentId: id,
        cadence: "30s",
        rules: "tick",
      }),
    );
    const agent = await agentHandlers.getAgent(create(grackle.AgentIdSchema, { id }));
    expect(agent.heartbeat).toBeDefined();
    expect(agent.heartbeat?.scheduleExpression).toBe("30s");
    expect(agent.heartbeat?.description).toBe("tick");
  });

  it("getAgent leaves heartbeat unset when no schedule exists", async () => {
    const { id } = await createAgentWithRoot("HB Absent");
    const agent = await agentHandlers.getAgent(create(grackle.AgentIdSchema, { id }));
    expect(agent.heartbeat).toBeUndefined();
  });

  it("listAgents populates heartbeat for each agent that has one", async () => {
    const a = await createAgentWithRoot("HB ListedA");
    const b = await createAgentWithRoot("HB ListedB");
    await agentHandlers.setAgentHeartbeat(
      create(grackle.SetAgentHeartbeatRequestSchema, {
        agentId: a.id,
        cadence: "30s",
        rules: "A rules",
      }),
    );
    // B has no heartbeat.
    const list = await agentHandlers.listAgents();
    const byName = Object.fromEntries(list.agents.map((x) => [x.name, x]));
    expect(byName["HB ListedA"].heartbeat?.scheduleExpression).toBe("30s");
    expect(byName["HB ListedB"].heartbeat).toBeUndefined();
  });
});
