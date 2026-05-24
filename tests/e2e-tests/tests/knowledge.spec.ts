import { test, expect } from "./fixtures.js";
import type { Page } from "@playwright/test";
import { createWorkspace, createTaskDirect, stubScenario, emitText, runStubTaskToCompletion } from "./helpers.js";

/**
 * Knowledge Graph E2E tests.
 *
 * These tests require the knowledge graph subsystem (embedding model) to be
 * available on the server. In CI the embedder is typically absent without
 * the Neo4j service container, so each test probes availability first and
 * skips gracefully if the backend returns UNAVAILABLE.
 */
test.describe("Knowledge Graph", { tag: ["@webui"] }, () => {
  /** Probe knowledge availability via SearchKnowledge RPC. Skip if unavailable. */
  async function skipIfKnowledgeUnavailable(
    client: ReturnType<typeof import("./rpc-client.js").createTestClient>,
  ): Promise<void> {
    try {
      await client.knowledge.searchKnowledge({ query: "probe", limit: 1 });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not available") || message.includes("Unavailable") || message.includes("unavailable")) {
        test.skip(true, "Knowledge graph not available in this environment");
      }
      throw error;
    }
  }

  /** Navigate to the Knowledge tab and wait for the page to load. */
  async function navigateToKnowledge(page: Page): Promise<void> {
    await page.locator('[data-testid="sidebar-tab-knowledge"]').click();
    await page.locator('[data-testid="knowledge-page"]').waitFor({ timeout: 5_000 });
  }

  test("knowledge page renders and shows graph container", async ({ appPage, grackle: { client } }) => {
    await skipIfKnowledgeUnavailable(client);
    await navigateToKnowledge(appPage);

    // The knowledge page should render with the nav and graph containers
    await expect(appPage.locator('[data-testid="knowledge-nav"]')).toBeVisible({ timeout: 5_000 });
  });

  test("derived mirror projects entities, structural edges, and is idempotent", async ({ grackle: { client } }) => {
    await skipIfKnowledgeUnavailable(client);

    // Create a workspace + parent/child tasks. Their create events drive the
    // entity-sync subscriber, which projects reference nodes (+ structural
    // edges) into Neo4j — no embedding needed for structural projection.
    const marker = `kgproj-${Date.now()}`;
    const wsId = await createWorkspace(client, `${marker}-ws`);
    // Parent needs decomposition rights to allow a child task.
    const parent = await createTaskDirect(client, wsId, `${marker}-parent`, { canDecompose: true });
    const parentId = (parent as unknown as { id: string }).id;
    const child = await createTaskDirect(client, wsId, `${marker}-child`, { parentTaskId: parentId });
    const childId = (child as unknown as { id: string }).id;

    // 1) Nodes project. listRecentKnowledgeNodes needs no embeddings, so this is
    //    deterministic (no embed-backfill wait): workspace + both task nodes.
    await expect
      .poll(
        async () => {
          const result = await client.knowledge.listRecentKnowledgeNodes({ limit: 200 });
          return result.nodes.filter((node) => node.label?.includes(marker)).length;
        },
        { timeout: 20_000, message: "workspace + task nodes should be projected into the KG" },
      )
      .toBeGreaterThanOrEqual(3);

    // 2) Structural edges: expanding the child reaches its parent (PART_OF) and
    //    its workspace (IN_WORKSPACE), proving FK→edge projection + traversal.
    //    Edges are projected just after their nodes, so poll the traversal until
    //    they land (avoids racing the subscriber).
    await expect
      .poll(
        async () => {
          const recent = await client.knowledge.listRecentKnowledgeNodes({ limit: 200 });
          const childNode = recent.nodes.find(
            (node) => node.sourceType === "task" && node.sourceId === childId,
          );
          if (!childNode) {
            return [];
          }
          const expanded = await client.knowledge.expandKnowledgeNode({ id: childNode.id, depth: 1 });
          return expanded.nodes.map((node) => `${node.sourceType}:${node.sourceId}`);
        },
        { timeout: 20_000, message: "child should reach its parent (PART_OF) and workspace (IN_WORKSPACE)" },
      )
      .toEqual(expect.arrayContaining([`task:${parentId}`, `workspace:${wsId}`]));

    // 3) Idempotency: re-projecting the parent (via an update event) updates the
    //    node in place — MERGE keyed on (sourceType, sourceId) never duplicates.
    const p = parent as unknown as { description: string; status: number };
    await client.orchestration.updateTask({
      id: parentId,
      title: `${marker}-parent-v2`,
      description: p.description,
      status: p.status,
      dependsOn: [],
    });
    await expect
      .poll(
        async () => {
          const result = await client.knowledge.listRecentKnowledgeNodes({ limit: 200 });
          const parentNodes = result.nodes.filter(
            (node) => node.sourceType === "task" && node.sourceId === parentId,
          );
          return parentNodes.length === 1 && (parentNodes[0].label?.includes("parent-v2") ?? false);
        },
        { timeout: 20_000, message: "re-projection must update in place, not create a duplicate node" },
      )
      .toBe(true);
  });

  test("transcript chunks are chunked, embedded, and semantically searchable", async ({ stubTask }) => {
    // Sessions/transcripts are reconciliation-driven (not event-driven), so this
    // waits for a reconciliation tick + local embedding — beyond the default 30s.
    test.setTimeout(90_000);
    const { page, client } = stubTask;
    await skipIfKnowledgeUnavailable(client);

    // Run a stub session that emits a recognizable line into its transcript.
    const marker = `KGMARKER-${Date.now()}`;
    await stubTask.createAndNavigate(
      "kg-transcript",
      stubScenario(emitText(`The deployment pipeline uses blue-green rollouts. Reference token ${marker}.`)),
    );
    await runStubTaskToCompletion(page); // emits the text → writes stream.jsonl → completes

    // The reconciliation phase projects the session, chunks the transcript, and
    // embeds the chunks inline — so a semantic query should return the chunk
    // (verified by the unique marker in its content). Generous timeout: this
    // waits for a phase tick + local embedding.
    await expect
      .poll(
        async () => {
          const result = await client.knowledge.searchKnowledge({
            query: "deployment pipeline blue-green rollout",
            limit: 10,
          });
          return result.results.some((hit) => hit.node?.content?.includes(marker));
        },
        { timeout: 45_000, message: "transcript chunk should be chunked, embedded, and searchable" },
      )
      .toBe(true);
  });
});
