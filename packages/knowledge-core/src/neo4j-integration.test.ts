import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  openNeo4j,
  closeNeo4j,
  getSession,
  initSchema,
  upsertReferenceNode,
  getReferenceNodeProps,
  listReferenceSourceIds,
  listNodesMissingEmbedding,
  deleteReferenceNodesByPrefix,
  pruneReferenceNodesNotIn,
  upsertEdge,
  removeOutgoingEdges,
  EDGE_TYPE,
  REFERENCE_SOURCE,
} from "./index.js";

/**
 * Opt-in Neo4j integration suite for the raw-Cypher primitives.
 *
 * The sibling unit tests mock the driver (they verify wiring, not real Cypher
 * behavior). This suite runs the primitives against a real Neo4j to prove the
 * MERGE/DELETE/constraint semantics the projection relies on. It is skipped by
 * default so the standard (no-Neo4j) test phase stays green; run it with:
 *
 *   GRACKLE_KG_INTEGRATION=1 GRACKLE_NEO4J_URL=bolt://127.0.0.1:7687 \
 *   GRACKLE_NEO4J_USER=neo4j GRACKLE_NEO4J_PASSWORD=grackle-dev \
 *   rush test --only @grackle-ai/knowledge-core
 *
 * All nodes are tagged with a per-run prefix and removed in afterAll, so the
 * suite is isolated and re-runnable against a shared Neo4j.
 */
const RUN =
  process.env.GRACKLE_KG_INTEGRATION === "1" || process.env.GRACKLE_KG_INTEGRATION === "true";

/** Per-run tag isolating this suite's nodes from any other data in the graph. */
const TAG = `int-${Date.now()}`;

/** Local-embedder dimensionality (the vector index size the server uses). */
const EMBED_DIM = 384;

describe.skipIf(!RUN)("knowledge-core Neo4j integration (raw Cypher primitives)", () => {
  beforeAll(async () => {
    await openNeo4j();
    await initSchema(EMBED_DIM);
  });

  afterAll(async () => {
    const session = getSession();
    try {
      await session.run(
        `MATCH (n:KnowledgeNode)
         WHERE n.sourceId STARTS WITH $tag OR n.sourceType STARTS WITH $tag
         DETACH DELETE n`,
        { tag: TAG },
      );
    } finally {
      await session.close();
    }
    await closeNeo4j();
  });

  it("upsertReferenceNode MERGEs on (sourceType, sourceId): same node, no duplicate, props updated", async () => {
    const sourceId = `${TAG}-t1`;
    const id1 = await upsertReferenceNode({
      sourceType: REFERENCE_SOURCE.TASK,
      sourceId,
      label: "first",
      workspaceId: "w",
    });
    const id2 = await upsertReferenceNode({
      sourceType: REFERENCE_SOURCE.TASK,
      sourceId,
      label: "second",
      workspaceId: "w",
    });
    expect(id2).toBe(id1);

    const ids = await listReferenceSourceIds(REFERENCE_SOURCE.TASK);
    expect(ids.filter((s) => s === sourceId)).toHaveLength(1);

    const props = await getReferenceNodeProps(REFERENCE_SOURCE.TASK, sourceId);
    expect(props?.label).toBe("second");
  });

  it("stores reference content and leaves an omitted embedding empty (size 0) for backfill", async () => {
    const sourceId = `${TAG}-c0`;
    await upsertReferenceNode({
      sourceType: REFERENCE_SOURCE.TRANSCRIPT_CHUNK,
      sourceId,
      label: "preview",
      content: "the deployment pipeline uses blue-green rollouts",
      workspaceId: "w",
    });

    const props = await getReferenceNodeProps(REFERENCE_SOURCE.TRANSCRIPT_CHUNK, sourceId);
    expect(props?.content).toBe("the deployment pipeline uses blue-green rollouts");

    const missing = await listNodesMissingEmbedding(200);
    expect(missing.some((n) => n.kind === "reference" && n.sourceId === sourceId)).toBe(true);
  });

  it("upsertEdge is idempotent; removeOutgoingEdges clears exactly one edge per type", async () => {
    const a = await upsertReferenceNode({
      sourceType: REFERENCE_SOURCE.TASK,
      sourceId: `${TAG}-a`,
      label: "A",
      workspaceId: "w",
    });
    const b = await upsertReferenceNode({
      sourceType: REFERENCE_SOURCE.TASK,
      sourceId: `${TAG}-b`,
      label: "B",
      workspaceId: "w",
    });
    await upsertEdge(a, b, EDGE_TYPE.DEPENDS_ON);
    await upsertEdge(a, b, EDGE_TYPE.DEPENDS_ON); // MERGE → still one edge

    const removed = await removeOutgoingEdges(a, [EDGE_TYPE.DEPENDS_ON]);
    expect(removed).toBe(1);
    // A second clear finds nothing.
    expect(await removeOutgoingEdges(a, [EDGE_TYPE.DEPENDS_ON])).toBe(0);
  });

  it("deleteReferenceNodesByPrefix removes all of a session's transcript chunks", async () => {
    const prefix = `${TAG}-sess#`;
    await upsertReferenceNode({
      sourceType: REFERENCE_SOURCE.TRANSCRIPT_CHUNK,
      sourceId: `${prefix}0`,
      label: "c0",
      content: "x",
      workspaceId: "w",
    });
    await upsertReferenceNode({
      sourceType: REFERENCE_SOURCE.TRANSCRIPT_CHUNK,
      sourceId: `${prefix}1`,
      label: "c1",
      content: "y",
      workspaceId: "w",
    });
    expect(await deleteReferenceNodesByPrefix(REFERENCE_SOURCE.TRANSCRIPT_CHUNK, prefix)).toBe(2);
  });

  it("pruneReferenceNodesNotIn deletes mirror nodes whose source is not in the live set", async () => {
    // Isolated custom source-type so the global (per-type) prune touches nothing
    // else in the graph.
    const sourceType = `${TAG}-prunetype`;
    await upsertReferenceNode({ sourceType, sourceId: `${TAG}-live`, label: "L", workspaceId: "" });
    await upsertReferenceNode({ sourceType, sourceId: `${TAG}-dead`, label: "D", workspaceId: "" });

    const pruned = await pruneReferenceNodesNotIn(sourceType, [`${TAG}-live`]);
    expect(pruned).toBe(1);
    expect(await listReferenceSourceIds(sourceType)).toEqual([`${TAG}-live`]);
  });

  it("the (sourceType, sourceId) uniqueness constraint rejects a duplicate raw insert", async () => {
    const sourceId = `${TAG}-uniq`;
    await upsertReferenceNode({
      sourceType: REFERENCE_SOURCE.TASK,
      sourceId,
      label: "orig",
      workspaceId: "w",
    });
    // Bypassing MERGE with a raw CREATE of the same identity must violate the
    // UNIQUE_SOURCE constraint (the guarantee that backs idempotent projection).
    const session = getSession();
    await expect(
      session.run(
        `CREATE (n:KnowledgeNode {kind: 'reference', sourceType: $sourceType, sourceId: $sourceId})`,
        { sourceType: REFERENCE_SOURCE.TASK, sourceId },
      ),
    ).rejects.toThrow();
    await session.close();
  });
});
