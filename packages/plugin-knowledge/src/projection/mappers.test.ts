import { describe, it, expect } from "vitest";
import { EDGE_TYPE, REFERENCE_SOURCE } from "@grackle-ai/knowledge";
import type {
  TaskRow,
  WorkspaceRow,
  SessionRow,
  PersonaRow,
  EnvironmentRow,
} from "@grackle-ai/database";
import {
  deriveTaskText,
  deriveWorkspaceText,
  deriveSessionText,
  derivePersonaText,
  deriveEnvironmentText,
} from "./derive-text.js";
import {
  computeProjectionHash,
  taskToNodeInput,
  workspaceToNodeInput,
  sessionToNodeInput,
  personaToNodeInput,
  environmentToNodeInput,
} from "./node-mappers.js";
import {
  taskEdges,
  sessionEdges,
  sessionSpawnEdge,
  workspaceLinkEdge,
  parseDependsOn,
} from "./edge-mappers.js";

// ── Row fixtures (partial → cast; mappers only read a subset of columns) ──

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "t1",
    workspaceId: "w1",
    title: "Do the thing",
    description: "with care",
    status: "working",
    dependsOn: "[]",
    parentTaskId: "",
    ...overrides,
  } as unknown as TaskRow;
}
function workspace(overrides: Partial<WorkspaceRow> = {}): WorkspaceRow {
  return { id: "w1", name: "Demo", description: "a ws", status: "active", ...overrides } as unknown as WorkspaceRow;
}
function session(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "s1",
    environmentId: "e1",
    taskId: "t1",
    personaId: "p1",
    parentSessionId: "",
    prompt: "fix the bug",
    model: "opus",
    status: "working",
    logPath: "/tmp/s1",
    ...overrides,
  } as unknown as SessionRow;
}
function persona(overrides: Partial<PersonaRow> = {}): PersonaRow {
  return { id: "p1", name: "Engineer", description: "writes code", ...overrides } as unknown as PersonaRow;
}
function environment(overrides: Partial<EnvironmentRow> = {}): EnvironmentRow {
  return { id: "e1", displayName: "Local", adapterType: "local", status: "connected", ...overrides } as unknown as EnvironmentRow;
}

describe("derive-text", () => {
  it("derives entity texts with [Entity] prefixes", () => {
    expect(deriveTaskText(task())).toBe("[Task] Do the thing - with care");
    expect(deriveTaskText(task({ description: "" }))).toBe("[Task] Do the thing");
    expect(deriveWorkspaceText(workspace())).toBe("[Workspace] Demo - a ws");
    expect(deriveSessionText(session())).toBe("[Session] fix the bug - model:opus");
    expect(derivePersonaText(persona())).toBe("[Persona] Engineer - writes code");
    expect(deriveEnvironmentText(environment())).toBe("[Environment] Local - adapter:local");
  });
});

describe("computeProjectionHash", () => {
  it("is deterministic and changes with input", () => {
    expect(computeProjectionHash("a", 1)).toBe(computeProjectionHash("a", 1));
    expect(computeProjectionHash("a", 1)).not.toBe(computeProjectionHash("a", 2));
  });
});

describe("node-mappers", () => {
  it("maps a task to a reference-node input", () => {
    const input = taskToNodeInput(task());
    expect(input.sourceType).toBe(REFERENCE_SOURCE.TASK);
    expect(input.sourceId).toBe("t1");
    expect(input.label).toContain("[Task]");
    expect(input.workspaceId).toBe("w1");
    expect(input.extraProps?.status).toBe("working");
    expect(typeof input.extraProps?.projectionHash).toBe("string");
  });

  it("defaults a null task workspaceId to empty string", () => {
    expect(taskToNodeInput(task({ workspaceId: null })).workspaceId).toBe("");
  });

  it("scopes a workspace node to itself", () => {
    expect(workspaceToNodeInput(workspace()).workspaceId).toBe("w1");
  });

  it("folds the linked-env set into the workspace hash (order-independent)", () => {
    const base = workspaceToNodeInput(workspace()).extraProps?.projectionHash;
    const linked = workspaceToNodeInput(workspace(), ["e1", "e2"]).extraProps?.projectionHash;
    const linkedReordered = workspaceToNodeInput(workspace(), ["e2", "e1"]).extraProps?.projectionHash;
    // A link change must change the hash (so the scan re-projects LINKED_TO)…
    expect(linked).not.toBe(base);
    // …but link *order* must not (the link set is what matters).
    expect(linkedReordered).toBe(linked);
  });

  it("uses the resolved workspaceId for a session", () => {
    expect(sessionToNodeInput(session(), "w9").workspaceId).toBe("w9");
  });

  it("scopes persona and environment nodes globally", () => {
    expect(personaToNodeInput(persona()).workspaceId).toBe("");
    expect(environmentToNodeInput(environment()).workspaceId).toBe("");
    expect(personaToNodeInput(persona()).sourceType).toBe(REFERENCE_SOURCE.PERSONA);
    expect(environmentToNodeInput(environment()).sourceType).toBe(REFERENCE_SOURCE.ENVIRONMENT);
  });
});

describe("edge-mappers", () => {
  it("parseDependsOn tolerates malformed JSON and filters non-strings", () => {
    expect(parseDependsOn('["a","b"]')).toEqual(["a", "b"]);
    expect(parseDependsOn("not json")).toEqual([]);
    expect(parseDependsOn('[1, "b", ""]')).toEqual(["b"]);
  });

  it("emits IN_WORKSPACE / PART_OF / DEPENDS_ON for a task", () => {
    const edges = taskEdges(task({ parentTaskId: "p", dependsOn: '["d1","d2"]' }));
    const types = edges.map((edge) => edge.type);
    expect(types).toContain(EDGE_TYPE.IN_WORKSPACE);
    expect(types).toContain(EDGE_TYPE.PART_OF);
    expect(edges.filter((edge) => edge.type === EDGE_TYPE.DEPENDS_ON)).toHaveLength(2);
  });

  it("emits no edge for empty/missing soft FKs", () => {
    const edges = taskEdges(task({ workspaceId: null, parentTaskId: "", dependsOn: "[]" }));
    expect(edges).toHaveLength(0);
  });

  it("emits ATTEMPT_OF / RAN_IN / USED_PERSONA for a session, skipping empties", () => {
    expect(sessionEdges(session()).map((edge) => edge.type).sort()).toEqual(
      [EDGE_TYPE.ATTEMPT_OF, EDGE_TYPE.RAN_IN, EDGE_TYPE.USED_PERSONA].sort(),
    );
    expect(sessionEdges(session({ taskId: "", personaId: "" })).map((edge) => edge.type)).toEqual([
      EDGE_TYPE.RAN_IN,
    ]);
  });

  it("returns a parent→child SPAWNED edge only when there is a parent", () => {
    expect(sessionSpawnEdge(session({ parentSessionId: "" }))).toBeUndefined();
    const spawn = sessionSpawnEdge(session({ id: "child", parentSessionId: "parent" }));
    expect(spawn).toEqual({
      from: { sourceType: REFERENCE_SOURCE.SESSION, sourceId: "parent" },
      to: { sourceType: REFERENCE_SOURCE.SESSION, sourceId: "child" },
      type: EDGE_TYPE.SPAWNED,
    });
  });

  it("builds a LINKED_TO edge for a workspace↔environment link", () => {
    expect(workspaceLinkEdge("w1", "e1")).toEqual({
      from: { sourceType: REFERENCE_SOURCE.WORKSPACE, sourceId: "w1" },
      to: { sourceType: REFERENCE_SOURCE.ENVIRONMENT, sourceId: "e1" },
      type: EDGE_TYPE.LINKED_TO,
    });
  });
});
