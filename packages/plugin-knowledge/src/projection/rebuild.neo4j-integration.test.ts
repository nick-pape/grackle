import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDatabase,
  initDatabase,
  sqlite,
  envRegistry,
  personaStore,
  workspaceStore,
  taskStore,
} from "@grackle-ai/database";
import {
  openNeo4j,
  closeNeo4j,
  getSession,
  initSchema,
  type Embedder,
} from "@grackle-ai/knowledge";
import { rebuild } from "./rebuild.js";

/**
 * Opt-in integration test for the derived-mirror keystone (#1258): rebuild() is
 * a deterministic projection of SQL — running it is idempotent, and recovery is
 * re-projection (never replay). Proven here against a real Neo4j + a real (temp)
 * SQLite. Skipped by default; run with:
 *
 *   GRACKLE_KG_INTEGRATION=1 GRACKLE_NEO4J_URL=bolt://127.0.0.1:7687 \
 *   GRACKLE_NEO4J_USER=neo4j GRACKLE_NEO4J_PASSWORD=grackle-dev \
 *   rush test --only @grackle-ai/plugin-knowledge
 */
const RUN =
  process.env.GRACKLE_KG_INTEGRATION === "1" || process.env.GRACKLE_KG_INTEGRATION === "true";

/** Local-embedder dimensionality (the vector index size the server uses). */
const EMBED_DIM = 384;

/** 1 env + 1 persona + 1 workspace + 3 tasks = 6 reference nodes (no sessions). */
const EXPECTED_NODES = 6;

// rebuild() only invokes the embedder for transcript chunks; with no sessions
// seeded it is never called, so a zero-vector fake avoids a model download.
const fakeEmbedder: Embedder = {
  dimensions: EMBED_DIM,
  embed: async () => ({ vector: new Array<number>(EMBED_DIM).fill(0) }),
  embedBatch: async (texts: string[]) =>
    texts.map(() => ({ vector: new Array<number>(EMBED_DIM).fill(0) })),
} as unknown as Embedder;

async function totalNodeCount(): Promise<number> {
  const session = getSession();
  try {
    const result = await session.run("MATCH (n:KnowledgeNode) RETURN count(n) AS c");
    const raw = result.records[0].get("c") as { toNumber?: () => number } | number;
    return typeof raw === "number" ? raw : (raw.toNumber?.() ?? Number(raw));
  } finally {
    await session.close();
  }
}

async function wipeNeo4j(): Promise<void> {
  const session = getSession();
  try {
    await session.run("MATCH (n) DETACH DELETE n");
  } finally {
    await session.close();
  }
}

describe.skipIf(!RUN)("rebuild() against real Neo4j: idempotency + keystone recovery", () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "kg-rebuild-"));
    openDatabase(join(tmp, "test.db"));
    initDatabase();
    await openNeo4j();
    await initSchema(EMBED_DIM);
    await wipeNeo4j();

    // Seed a connected slice of the ecosystem: env ← workspace, a persona, and
    // parent/child tasks (PART_OF) plus a dependency (DEPENDS_ON).
    envRegistry.addEnvironment("env-int", "Int Env", "local", "{}");
    personaStore.createPersona(
      "persona-int",
      "Int Persona",
      "",
      "prompt",
      "{}",
      "stub",
      "sonnet",
      0,
      "[]",
    );
    workspaceStore.createWorkspaceAndLink(
      "ws-int",
      "Int WS",
      "",
      "",
      true,
      "",
      "",
      0,
      0,
      "env-int",
    );
    taskStore.createTask("t-parent", "ws-int", "Parent", "", [], "int-parent", "", true);
    taskStore.createTask("t-child", "ws-int", "Child", "", [], "int-child", "t-parent");
    taskStore.createTask("t-dep", "ws-int", "Dependent", "", ["t-parent"], "int-dep", "");
  });

  afterAll(async () => {
    await wipeNeo4j();
    await closeNeo4j();
    // Close the SQLite handle before removing the temp dir (Windows locks the
    // file otherwise). Cleanup is best-effort — the OS temp dir is reclaimed.
    sqlite?.close();
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // ignore: temp-dir removal is non-fatal
    }
  });

  it("is idempotent: rebuilding twice yields identical counts and no duplicate nodes", async () => {
    const first = await rebuild(fakeEmbedder);
    const afterFirst = await totalNodeCount();
    const second = await rebuild(fakeEmbedder);
    const afterSecond = await totalNodeCount();

    expect(second).toEqual(first); // identical RebuildResult
    expect(afterSecond).toBe(afterFirst); // MERGE keyed on (sourceType, sourceId) → no duplicates
    expect(afterFirst).toBe(EXPECTED_NODES);
    expect(first.tasks).toBe(3);
    expect(first.workspaces).toBe(1);
  });

  it("keystone recovery: wiping Neo4j and rebuilding reproduces the graph from SQL", async () => {
    const baseline = await rebuild(fakeEmbedder);
    const baselineCount = await totalNodeCount();
    expect(baselineCount).toBe(EXPECTED_NODES);

    // Simulate total loss of the derived store.
    await wipeNeo4j();
    expect(await totalNodeCount()).toBe(0);

    // Recovery = re-project from SQL (no replay). The graph is fully restored.
    const recovered = await rebuild(fakeEmbedder);
    expect(recovered).toEqual(baseline);
    expect(await totalNodeCount()).toBe(baselineCount);
  });
});
