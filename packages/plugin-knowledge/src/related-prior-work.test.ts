import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SpawnContextInput } from "@grackle-ai/plugin-sdk";

// Tests set GRACKLE_KG_RELATED_* env knobs; process.env is shared across the
// Vitest worker, so scrub them after every test to avoid order-dependent leaks
// into other tests/files.
afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GRACKLE_KG_RELATED_") || key === "GRACKLE_KG_SPAWN_CONTEXT_TIMEOUT_MS") {
      delete process.env[key];
    }
  }
});

// ── Mocks ────────────────────────────────────────────────────
const kg = vi.hoisted(() => ({
  knowledgeSearch: vi.fn(),
  expandNode: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
  findReferenceNodeBySource: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@grackle-ai/knowledge", () => ({
  knowledgeSearch: kg.knowledgeSearch,
  expandNode: kg.expandNode,
  findReferenceNodeBySource: kg.findReferenceNodeBySource,
  REFERENCE_SOURCE: { TASK: "task", SESSION: "session", TRANSCRIPT_CHUNK: "transcript_chunk" },
}));

const gate = vi.hoisted(() => ({ isHealthy: vi.fn(() => true), getEmbedder: vi.fn(() => ({})) }));
vi.mock("./knowledge-init.js", () => ({ getKnowledgeEmbedder: gate.getEmbedder }));
vi.mock("./knowledge-health.js", () => ({ isNeo4jHealthy: gate.isHealthy }));

const log = vi.hoisted(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("./logger.js", () => ({ logger: log }));

import { buildRelatedPriorWork } from "./related-prior-work.js";

interface RefNodeOpts {
  id: string;
  sourceType: string;
  sourceId: string;
  label: string;
  content?: string;
  workspaceId?: string;
}
function refNode(o: RefNodeOpts): Record<string, unknown> {
  return {
    kind: "reference",
    id: o.id,
    sourceType: o.sourceType,
    sourceId: o.sourceId,
    label: o.label,
    content: o.content,
    workspaceId: o.workspaceId ?? "w1",
    embedding: [],
    createdAt: "",
    updatedAt: "",
  };
}
function result(node: Record<string, unknown>, score: number): Record<string, unknown> {
  return { node, score, edges: [] };
}

const input: SpawnContextInput = {
  taskId: "t1",
  title: "Build JWT auth",
  description: "replace sessions",
  workspaceId: "w1",
  isOrchestrator: false,
  injectKnowledge: true,
};

describe("buildRelatedPriorWork — gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gate.isHealthy.mockReturnValue(true);
    gate.getEmbedder.mockReturnValue({});
    kg.expandNode.mockResolvedValue({ nodes: [], edges: [] });
    kg.findReferenceNodeBySource.mockResolvedValue(undefined);
    delete process.env.GRACKLE_KG_RELATED_MIN_SCORE;
    delete process.env.GRACKLE_KG_RELATED_EXPAND;
  });

  it("returns undefined and does not search when the task opted out", async () => {
    expect(await buildRelatedPriorWork({ ...input, injectKnowledge: false })).toBeUndefined();
    expect(kg.knowledgeSearch).not.toHaveBeenCalled();
  });

  it("returns undefined when Neo4j is unhealthy", async () => {
    gate.isHealthy.mockReturnValue(false);
    expect(await buildRelatedPriorWork(input)).toBeUndefined();
    expect(kg.knowledgeSearch).not.toHaveBeenCalled();
  });

  it("returns undefined when no embedder is available", async () => {
    gate.getEmbedder.mockReturnValue(undefined);
    expect(await buildRelatedPriorWork(input)).toBeUndefined();
  });

  it("returns undefined for an empty workspace scope", async () => {
    expect(await buildRelatedPriorWork({ ...input, workspaceId: "" })).toBeUndefined();
    expect(kg.knowledgeSearch).not.toHaveBeenCalled();
  });

  it("returns undefined when search yields nothing", async () => {
    kg.knowledgeSearch.mockResolvedValue([]);
    expect(await buildRelatedPriorWork(input)).toBeUndefined();
  });
});

describe("buildRelatedPriorWork — retrieval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gate.isHealthy.mockReturnValue(true);
    gate.getEmbedder.mockReturnValue({});
    kg.expandNode.mockResolvedValue({ nodes: [], edges: [] });
    kg.findReferenceNodeBySource.mockResolvedValue(undefined);
    process.env.GRACKLE_KG_RELATED_EXPAND = "false"; // isolate search behavior
    delete process.env.GRACKLE_KG_RELATED_MIN_SCORE;
  });

  it("scopes to the workspace and passes the conservative min-score floor", async () => {
    kg.knowledgeSearch.mockResolvedValue([
      result(refNode({ id: "n2", sourceType: "task", sourceId: "t2", label: "[Task] Prior auth work" }), 0.72),
    ]);
    await buildRelatedPriorWork(input);
    expect(kg.knowledgeSearch).toHaveBeenCalledWith(
      expect.stringContaining("[Task] Build JWT auth"),
      expect.anything(),
      expect.objectContaining({ workspaceId: "w1", minScore: 0.35, limit: 5 }),
    );
  });

  it("env override changes the min-score floor", async () => {
    process.env.GRACKLE_KG_RELATED_MIN_SCORE = "0.5";
    kg.knowledgeSearch.mockResolvedValue([
      result(refNode({ id: "n2", sourceType: "task", sourceId: "t2", label: "x" }), 0.9),
    ]);
    await buildRelatedPriorWork(input);
    expect(kg.knowledgeSearch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ minScore: 0.5 }),
    );
  });

  it("excludes the task's own node by sourceId even when findReferenceNodeBySource misses", async () => {
    kg.knowledgeSearch.mockResolvedValue([
      result(refNode({ id: "self", sourceType: "task", sourceId: "t1", label: "[Task] self" }), 0.99),
      result(refNode({ id: "n2", sourceType: "task", sourceId: "t2", label: "[Task] other" }), 0.71),
    ]);
    const out = await buildRelatedPriorWork(input);
    expect(out).toContain("other");
    expect(out).not.toContain("self");
  });

  it("excludes the task's own node by resolved node id", async () => {
    kg.findReferenceNodeBySource.mockResolvedValue({ id: "selfid" });
    kg.knowledgeSearch.mockResolvedValue([
      result(refNode({ id: "selfid", sourceType: "task", sourceId: "weird", label: "[Task] self" }), 0.99),
      result(refNode({ id: "n2", sourceType: "task", sourceId: "t2", label: "[Task] other" }), 0.71),
    ]);
    const out = await buildRelatedPriorWork(input);
    expect(out).toContain("other");
    expect(out).not.toContain("self");
  });

  it("formats a header, reference label+similarity, and chunk content snippet", async () => {
    kg.knowledgeSearch.mockResolvedValue([
      result(refNode({ id: "n2", sourceType: "task", sourceId: "t2", label: "[Task] Prior auth" }), 0.72),
      result(refNode({ id: "n3", sourceType: "transcript_chunk", sourceId: "s1#0", label: "chunk", content: "We chose blue-green rollouts." }), 0.61),
    ]);
    const out = await buildRelatedPriorWork(input);
    expect(out).toContain("## Related prior work");
    expect(out).toContain("[task] [Task] Prior auth (similarity 0.72)");
    expect(out).toContain("blue-green rollouts");
  });

  it("honors the char budget (stops before overflow)", async () => {
    process.env.GRACKLE_KG_RELATED_MAX_CHARS = "400";
    const many = Array.from({ length: 20 }, (_, i) =>
      result(refNode({ id: `n${i}`, sourceType: "task", sourceId: `t${i + 10}`, label: `[Task] item ${i} with a fairly long title to consume budget` }), 0.6),
    );
    kg.knowledgeSearch.mockResolvedValue(many);
    const out = await buildRelatedPriorWork(input);
    expect(out).toBeDefined();
    expect(out!.length).toBeLessThanOrEqual(400);
    // First item fits; later items are dropped once the budget is reached.
    expect(out).toContain("item 0");
    expect(out).not.toContain("item 19");
    delete process.env.GRACKLE_KG_RELATED_MAX_CHARS;
  });

  it("caps the number of items to RELATED_MAX_ITEMS", async () => {
    process.env.GRACKLE_KG_RELATED_MAX_ITEMS = "2";
    process.env.GRACKLE_KG_RELATED_MAX_CHARS = "5000";
    const many = Array.from({ length: 10 }, (_, i) =>
      result(refNode({ id: `n${i}`, sourceType: "task", sourceId: `t${i + 10}`, label: `[Task] item ${i}` }), 0.6),
    );
    kg.knowledgeSearch.mockResolvedValue(many);
    const out = await buildRelatedPriorWork(input);
    const bulletCount = (out!.match(/^- /gm) ?? []).length;
    expect(bulletCount).toBe(2);
    delete process.env.GRACKLE_KG_RELATED_MAX_ITEMS;
    delete process.env.GRACKLE_KG_RELATED_MAX_CHARS;
  });
});

describe("buildRelatedPriorWork — metrics log (#1260)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gate.isHealthy.mockReturnValue(true);
    gate.getEmbedder.mockReturnValue({});
    kg.expandNode.mockResolvedValue({ nodes: [], edges: [] });
    kg.findReferenceNodeBySource.mockResolvedValue(undefined);
    process.env.GRACKLE_KG_RELATED_EXPAND = "false";
  });

  it("emits a kg_spawn_retrieval event with metadata when a block is built", async () => {
    kg.knowledgeSearch.mockResolvedValue([
      result(refNode({ id: "n2", sourceType: "task", sourceId: "t2", label: "[Task] Prior auth" }), 0.72),
    ]);
    await buildRelatedPriorWork(input);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "kg_spawn_retrieval",
        taskId: "t1",
        workspaceId: "w1",
        injected: true,
        hits: 1,
        candidates: 1,
        items: 1,
        topScore: 0.72,
      }),
      expect.any(String),
    );
  });

  it("emits injected:false when the search returns nothing", async () => {
    kg.knowledgeSearch.mockResolvedValue([]);
    await buildRelatedPriorWork(input);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "kg_spawn_retrieval", injected: false, hits: 0, items: 0 }),
      expect.any(String),
    );
  });
});
