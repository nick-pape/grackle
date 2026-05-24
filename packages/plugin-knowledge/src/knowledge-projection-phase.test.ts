import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Embedder } from "@grackle-ai/knowledge";

// ── Mocks (all module-load deps of the phase) ───────────────

vi.mock("@grackle-ai/database", () => ({
  sessionStore: { listSessions: vi.fn(() => []) },
  taskStore: { listTasks: vi.fn(() => []), getTask: vi.fn() },
  workspaceStore: { listWorkspaces: vi.fn(() => []) },
  personaStore: { listPersonas: vi.fn(() => []) },
  envRegistry: { listEnvironments: vi.fn(() => []) },
}));

const kg = vi.hoisted(() => ({
  getReferenceNodeProps: vi.fn(),
  listReferenceSourceIds: vi.fn().mockResolvedValue([]),
  listNodesMissingEmbedding: vi.fn().mockResolvedValue([]),
  updateNode: vi.fn().mockResolvedValue(undefined),
  pruneReferenceNodesNotIn: vi.fn().mockResolvedValue(0),
}));
vi.mock("@grackle-ai/knowledge", () => ({
  getReferenceNodeProps: kg.getReferenceNodeProps,
  listReferenceSourceIds: kg.listReferenceSourceIds,
  listNodesMissingEmbedding: kg.listNodesMissingEmbedding,
  updateNode: kg.updateNode,
  pruneReferenceNodesNotIn: kg.pruneReferenceNodesNotIn,
  REFERENCE_SOURCE: {
    SESSION: "session", TASK: "task", WORKSPACE: "workspace",
    PERSONA: "persona", ENVIRONMENT: "environment",
  },
}));
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./projection/node-mappers.js", () => ({
  sessionToNodeInput: vi.fn(() => ({ extraProps: {} })),
  environmentToNodeInput: vi.fn(() => ({ extraProps: {} })),
  personaToNodeInput: vi.fn(() => ({ extraProps: {} })),
  workspaceToNodeInput: vi.fn(() => ({ extraProps: {} })),
  taskToNodeInput: vi.fn(() => ({ extraProps: {} })),
}));
vi.mock("./projection/project-entity.js", () => ({
  projectSession: vi.fn(), linkSessionSpawn: vi.fn(),
  projectEnvironment: vi.fn(), projectPersona: vi.fn(),
  projectWorkspace: vi.fn(), projectTask: vi.fn(),
}));
vi.mock("./projection/project-transcript.js", () => ({
  projectSessionTranscript: vi.fn().mockResolvedValue(0),
  unprojectSessionTranscript: vi.fn().mockResolvedValue(0),
}));

import { createKnowledgeProjectionPhase } from "./knowledge-projection-phase.js";

function fakeEmbedder(embed = vi.fn().mockResolvedValue({ vector: [0.1, 0.2] })): Embedder {
  return { embed, embedBatch: vi.fn(), dimensions: 384 } as unknown as Embedder;
}

describe("knowledge-projection phase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kg.listReferenceSourceIds.mockResolvedValue([]);
    kg.listNodesMissingEmbedding.mockResolvedValue([]);
  });

  it("is named knowledge-projection", () => {
    const phase = createKnowledgeProjectionPhase({ getEmbedder: () => fakeEmbedder(), isHealthy: () => true });
    expect(phase.name).toBe("knowledge-projection");
  });

  it("no-ops when the embedder is unavailable", async () => {
    const phase = createKnowledgeProjectionPhase({ getEmbedder: () => undefined, isHealthy: () => true });
    await phase.execute();
    expect(kg.listNodesMissingEmbedding).not.toHaveBeenCalled();
  });

  it("no-ops when Neo4j is unhealthy", async () => {
    const phase = createKnowledgeProjectionPhase({ getEmbedder: () => fakeEmbedder(), isHealthy: () => false });
    await phase.execute();
    expect(kg.listNodesMissingEmbedding).not.toHaveBeenCalled();
  });

  it("backfills embeddings for nodes that have none (makes them searchable)", async () => {
    const embed = vi.fn().mockResolvedValue({ vector: [0.5, 0.6] });
    kg.listNodesMissingEmbedding.mockResolvedValueOnce([{ id: "n1", kind: "reference", label: "Task X" }]);
    const phase = createKnowledgeProjectionPhase({ getEmbedder: () => fakeEmbedder(embed), isHealthy: () => true });
    await phase.execute();
    expect(embed).toHaveBeenCalledWith("Task X");
    expect(kg.updateNode).toHaveBeenCalledWith("n1", { embedding: [0.5, 0.6] });
  });

  it("treats embedding failures as non-fatal (retried next tick)", async () => {
    const embed = vi.fn().mockRejectedValue(new Error("model busy"));
    kg.listNodesMissingEmbedding.mockResolvedValueOnce([{ id: "n1", kind: "reference", label: "X" }]);
    const phase = createKnowledgeProjectionPhase({ getEmbedder: () => fakeEmbedder(embed), isHealthy: () => true });
    await expect(phase.execute()).resolves.toBeUndefined();
    expect(kg.updateNode).not.toHaveBeenCalled();
  });
});
