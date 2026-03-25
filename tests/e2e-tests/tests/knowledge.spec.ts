import { test, expect } from "./fixtures.js";
import type { Page } from "@playwright/test";
import { createWorkspace } from "./helpers.js";

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
      await client.searchKnowledge({ query: "probe", limit: 1 });
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

  test("seeded nodes appear in the knowledge nav", async ({ appPage, grackle: { client } }) => {
    await skipIfKnowledgeUnavailable(client);

    // Seed knowledge data with unique titles to avoid cross-test contamination
    const wsId = await createWorkspace(client, "kg-seeded");
    await client.createKnowledgeNode({
      title: "E2E Auth Flow Design 7x9k",
      content: "OAuth2 PKCE flow for CLI clients",
      category: "concept",
      tags: ["auth"],
      workspaceId: wsId,
    });
    await client.createKnowledgeNode({
      title: "E2E Database Schema 7x9k",
      content: "SQLite for single-node deployments",
      category: "decision",
      tags: ["database"],
      workspaceId: wsId,
    });

    await navigateToKnowledge(appPage);

    // Nodes should appear in the sidebar nav (loadRecent fetches all nodes)
    const nav = appPage.locator('[data-testid="knowledge-nav"]');
    await expect(nav.getByText("E2E Auth Flow Design 7x9k")).toBeVisible({ timeout: 15_000 });
    await expect(nav.getByText("E2E Database Schema 7x9k")).toBeVisible();

    // Graph container should be visible
    await expect(appPage.locator('[data-testid="knowledge-graph"]')).toBeVisible();
  });

  test("clicking a node opens the detail panel", async ({ appPage, grackle: { client } }) => {
    await skipIfKnowledgeUnavailable(client);

    const wsId = await createWorkspace(client, "kg-detail");
    await client.createKnowledgeNode({
      title: "E2E Click Target q3m8",
      content: "This content should appear in the detail panel",
      category: "insight",
      tags: [],
      workspaceId: wsId,
    });

    await navigateToKnowledge(appPage);

    // Wait for node to load, then click in the sidebar nav
    const nav = appPage.locator('[data-testid="knowledge-nav"]');
    await expect(nav.getByText("E2E Click Target q3m8")).toBeVisible({ timeout: 15_000 });
    await nav.getByText("E2E Click Target q3m8").click();

    // Detail panel should open with the node's content
    await expect(appPage.locator('[data-testid="knowledge-detail-panel"]')).toBeVisible({ timeout: 5_000 });
    await expect(appPage.locator('[data-testid="knowledge-detail-panel"]')).toContainText("E2E Click Target q3m8");
    await expect(appPage.locator('[data-testid="knowledge-detail-panel"]')).toContainText("This content should appear in the detail panel");
  });

  test("search finds knowledge nodes", async ({ appPage, grackle: { client } }) => {
    await skipIfKnowledgeUnavailable(client);

    const wsId = await createWorkspace(client, "kg-search");
    await client.createKnowledgeNode({
      title: "E2E Searchable Alpha p4n2",
      content: "Content specifically about alpha concepts for search testing",
      category: "concept",
      tags: [],
      workspaceId: wsId,
    });

    await navigateToKnowledge(appPage);

    // Wait for initial load
    const nav = appPage.locator('[data-testid="knowledge-nav"]');
    await expect(nav.getByText("E2E Searchable Alpha p4n2")).toBeVisible({ timeout: 15_000 });

    // Search for the unique title
    await appPage.locator('[data-testid="knowledge-search-input"]').fill("Searchable Alpha p4n2");
    await appPage.locator('[data-testid="knowledge-search-input"]').press("Enter");

    // The search results should include the node
    await expect(appPage.locator('[data-testid="knowledge-nav"]')).toContainText("E2E Searchable Alpha p4n2", { timeout: 15_000 });
  });
});
