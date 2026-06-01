import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AgentRow, TaskRow } from "@grackle-ai/database";
import type { GrackleEvent, PluginContext } from "@grackle-ai/core";
import {
  handleAgentCreated,
  createAgentRootTaskSubscriber,
  type AgentRootTaskBootDeps,
} from "./agent-root-task-boot.js";

interface InsertedTask {
  id: string;
  title: string;
  agentId?: string;
  kind?: string;
  parentTaskId: string;
  depth: number;
  canDecompose: boolean;
  defaultPersonaId: string;
}

interface MockState {
  agents: Map<string, AgentRow>;
  rootByAgent: Map<string, TaskRow>;
  inserted: InsertedTask[];
  idCounter: number;
}

function buildDeps(state: MockState): AgentRootTaskBootDeps {
  return {
    getAgent: (id) => state.agents.get(id),
    getRootTaskForAgent: (agentId) => state.rootByAgent.get(agentId),
    insertTask: (fields) => {
      state.inserted.push({
        id: fields.id,
        title: fields.title,
        agentId: fields.agentId,
        kind: fields.kind,
        parentTaskId: fields.parentTaskId,
        depth: fields.depth,
        canDecompose: fields.canDecompose,
        defaultPersonaId: fields.defaultPersonaId,
      });
      // After insert, the next getRootTaskForAgent should return this row.
      // Build a minimal TaskRow shape — the subscriber only ever reads it
      // back via `getRootTaskForAgent` in the idempotency check, which
      // doesn't inspect any column. A typed cast keeps the test honest.
      state.rootByAgent.set(fields.agentId!, {
        id: fields.id,
        title: fields.title,
        agentId: fields.agentId ?? null,
        kind: fields.kind ?? "task",
      } as unknown as TaskRow);
    },
    newId: () => {
      state.idCounter += 1;
      return `root-task-${state.idCounter}`;
    },
  };
}

function makeAgent(id: string, name: string, personaId = "claude-code"): AgentRow {
  return {
    id,
    name,
    avatar: "",
    primaryPersonaId: personaId,
    environmentId: "local",
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
  };
}

describe("handleAgentCreated", () => {
  let state: MockState;
  let deps: AgentRootTaskBootDeps;

  beforeEach(() => {
    state = {
      agents: new Map(),
      rootByAgent: new Map(),
      inserted: [],
      idCounter: 0,
    };
    deps = buildDeps(state);
  });

  it("creates a root task for a newly-created agent", () => {
    state.agents.set("a1", makeAgent("a1", "Refactor Bot", "claude-code"));

    handleAgentCreated(deps, { agentId: "a1" });

    expect(state.inserted).toHaveLength(1);
    const t = state.inserted[0];
    expect(t.title).toBe("Refactor Bot");
    expect(t.kind).toBe("root");
    expect(t.agentId).toBe("a1");
    expect(t.parentTaskId).toBe("");
    expect(t.depth).toBe(0);
    expect(t.canDecompose).toBe(true);
    expect(t.defaultPersonaId).toBe("claude-code");
  });

  it("is idempotent — running the handler twice creates only one root task", () => {
    state.agents.set("a1", makeAgent("a1", "Refactor Bot"));

    handleAgentCreated(deps, { agentId: "a1" });
    handleAgentCreated(deps, { agentId: "a1" });

    expect(state.inserted).toHaveLength(1);
  });

  it("is a no-op when the agent has already been deleted", () => {
    // No agent stored — simulates the race where agent.created fires then
    // agent.deleted lands before this handler runs.
    handleAgentCreated(deps, { agentId: "ghost" });
    expect(state.inserted).toHaveLength(0);
  });

  it("preserves each agent's own root in a multi-agent scenario", () => {
    state.agents.set("a1", makeAgent("a1", "Bot One"));
    state.agents.set("a2", makeAgent("a2", "Bot Two", "codex"));

    handleAgentCreated(deps, { agentId: "a1" });
    handleAgentCreated(deps, { agentId: "a2" });

    expect(state.inserted).toHaveLength(2);
    expect(state.inserted[0].agentId).toBe("a1");
    expect(state.inserted[0].defaultPersonaId).toBe("claude-code");
    expect(state.inserted[1].agentId).toBe("a2");
    expect(state.inserted[1].defaultPersonaId).toBe("codex");
  });

  it("propagates the agent's primary persona id to the root task default", () => {
    state.agents.set("a1", makeAgent("a1", "X", "my-persona"));
    handleAgentCreated(deps, { agentId: "a1" });
    expect(state.inserted[0].defaultPersonaId).toBe("my-persona");
  });
});

describe("createAgentRootTaskSubscriber", () => {
  it("fires handleAgentCreated when an agent.created event arrives", () => {
    const state: MockState = {
      agents: new Map([["a1", makeAgent("a1", "Subbed Bot")]]),
      rootByAgent: new Map(),
      inserted: [],
      idCounter: 0,
    };
    const deps = buildDeps(state);

    // Capture the subscriber callback by spying on ctx.subscribe.
    let captured: ((event: GrackleEvent) => void) | undefined;
    const ctx: PluginContext = {
      subscribe: vi.fn((cb) => {
        captured = cb;
        return () => {};
      }),
      emit: vi.fn(),
    };

    const disposable = createAgentRootTaskSubscriber(ctx, deps);
    expect(ctx.subscribe).toHaveBeenCalledTimes(1);
    expect(captured).toBeDefined();

    captured!({
      type: "agent.created",
      payload: { agentId: "a1" },
      timestamp: "2026-05-31T00:00:00.000Z",
    } as GrackleEvent);

    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].agentId).toBe("a1");

    disposable.dispose();
  });

  it("ignores events of other types", () => {
    const state: MockState = {
      agents: new Map([["a1", makeAgent("a1", "Ignore Me")]]),
      rootByAgent: new Map(),
      inserted: [],
      idCounter: 0,
    };
    const deps = buildDeps(state);

    let captured: ((event: GrackleEvent) => void) | undefined;
    const ctx: PluginContext = {
      subscribe: vi.fn((cb) => {
        captured = cb;
        return () => {};
      }),
      emit: vi.fn(),
    };

    createAgentRootTaskSubscriber(ctx, deps);

    captured!({
      type: "agent.updated",
      payload: { agentId: "a1" },
      timestamp: "2026-05-31T00:00:00.000Z",
    } as GrackleEvent);

    expect(state.inserted).toHaveLength(0);
  });

  it("ignores agent.created events with no agentId in payload", () => {
    const state: MockState = {
      agents: new Map(),
      rootByAgent: new Map(),
      inserted: [],
      idCounter: 0,
    };
    const deps = buildDeps(state);

    let captured: ((event: GrackleEvent) => void) | undefined;
    const ctx: PluginContext = {
      subscribe: vi.fn((cb) => {
        captured = cb;
        return () => {};
      }),
      emit: vi.fn(),
    };

    createAgentRootTaskSubscriber(ctx, deps);

    captured!({
      type: "agent.created",
      payload: {},
      timestamp: "2026-05-31T00:00:00.000Z",
    } as GrackleEvent);

    expect(state.inserted).toHaveLength(0);
  });
});
