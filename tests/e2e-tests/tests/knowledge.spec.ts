import { test, expect } from "./fixtures.js";
import type { Page } from "@playwright/test";

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

  // Node-seeding coverage (browse / click / search) returns in #1258, when the
  // derived-mirror projection populates the graph. As of #1257 the graph has no
  // agent-authored write path, so there is nothing to seed here.
});
