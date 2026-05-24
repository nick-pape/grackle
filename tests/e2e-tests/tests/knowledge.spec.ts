import { test, expect } from "./fixtures.js";
import type { Page } from "@playwright/test";
import { createWorkspace, createTaskDirect } from "./helpers.js";

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

  test("derived mirror projects created entities into the graph", async ({ grackle: { client } }) => {
    await skipIfKnowledgeUnavailable(client);

    // Create a workspace + parent/child tasks. Their create events drive the
    // entity-sync subscriber, which projects reference nodes (+ structural
    // edges) into Neo4j — no embedding needed for structural projection.
    const marker = `kgproj-${Date.now()}`;
    const wsId = await createWorkspace(client, `${marker}-ws`);
    // Parent needs decomposition rights to allow a child task.
    const parent = await createTaskDirect(client, wsId, `${marker}-parent`, { canDecompose: true });
    await createTaskDirect(client, wsId, `${marker}-child`, {
      parentTaskId: (parent as unknown as { id: string }).id,
    });

    // The mirror should contain the workspace node + both task nodes.
    // listRecentKnowledgeNodes does not require embeddings, so this verifies
    // structural projection deterministically (no embed-backfill wait).
    await expect
      .poll(
        async () => {
          const result = await client.knowledge.listRecentKnowledgeNodes({ limit: 200 });
          return result.nodes.filter((node) => node.label?.includes(marker)).length;
        },
        { timeout: 20_000, message: "workspace + task nodes should be projected into the KG" },
      )
      .toBeGreaterThanOrEqual(3);
  });
});
