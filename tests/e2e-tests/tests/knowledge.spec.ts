import { test, expect } from "./fixtures.js";
import { createWorkspace } from "./helpers.js";

/**
 * Knowledge Graph E2E tests.
 *
 * These tests require the knowledge graph subsystem (embedding model) to be
 * available on the server. In CI the embedder is typically absent, so each
 * test probes availability first and skips gracefully if the backend returns
 * UNAVAILABLE.
 */
test.describe("Knowledge Graph", { tag: ["@webui"] }, () => {
  /**
   * Probe knowledge availability via SearchKnowledge RPC (requires the
   * embedder, unlike listRecentKnowledgeNodes which only checks the enabled
   * flag). Skip the test if the server returns UNAVAILABLE.
   */
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

  test("knowledge page renders with empty state", async ({ appPage, grackle: { client } }) => {
    await skipIfKnowledgeUnavailable(client);
    const page = appPage;

    // Create a fresh workspace with no knowledge nodes to avoid cross-test contamination
    const wsId = await createWorkspace(client, "kg-empty");

    // Navigate to Knowledge tab
    await page.locator('[data-testid="sidebar-tab-knowledge"]').click();
    await page.locator('[data-testid="knowledge-page"]').waitFor({ timeout: 5_000 });

    // Filter to the empty workspace
    await page.locator('[data-testid="knowledge-workspace-filter"]').selectOption(wsId);

    // Empty state message
    await expect(page.getByText("No knowledge nodes found.")).toBeVisible({ timeout: 10_000 });
  });

  test("knowledge page shows seeded nodes in nav and graph", async ({ appPage, grackle: { client } }) => {
    await skipIfKnowledgeUnavailable(client);
    const page = appPage;

    // Seed knowledge data
    const wsId = await createWorkspace(client, "kg-seeded");
    await client.createKnowledgeNode({
      title: "Auth Flow Design",
      content: "OAuth2 PKCE flow for CLI clients",
      category: "concept",
      tags: ["auth"],
      workspaceId: wsId,
    });
    await client.createKnowledgeNode({
      title: "Database Schema Choice",
      content: "SQLite for single-node deployments",
      category: "decision",
      tags: ["database"],
      workspaceId: wsId,
    });

    // Navigate to Knowledge tab
    await page.locator('[data-testid="sidebar-tab-knowledge"]').click();
    await page.locator('[data-testid="knowledge-page"]').waitFor({ timeout: 5_000 });

    // Filter to the workspace where we seeded nodes to avoid cross-test contamination
    await page.locator('[data-testid="knowledge-workspace-filter"]').selectOption(wsId);

    // Seeded nodes should appear in the sidebar nav
    await expect(page.getByText("Auth Flow Design")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Database Schema Choice")).toBeVisible();

    // Graph container should be visible with SVG content
    await expect(page.locator('[data-testid="knowledge-graph"]')).toBeVisible();
  });

  test("clicking a node opens the detail panel", async ({ appPage, grackle: { client } }) => {
    await skipIfKnowledgeUnavailable(client);
    const page = appPage;

    // Seed a knowledge node
    const wsId = await createWorkspace(client, "kg-detail");
    await client.createKnowledgeNode({
      title: "Click Target Node",
      content: "This content should appear in the detail panel",
      category: "insight",
      tags: [],
      workspaceId: wsId,
    });

    // Navigate to Knowledge tab
    await page.locator('[data-testid="sidebar-tab-knowledge"]').click();
    await page.locator('[data-testid="knowledge-page"]').waitFor({ timeout: 5_000 });

    // Filter to the workspace to isolate from other tests
    await page.locator('[data-testid="knowledge-workspace-filter"]').selectOption(wsId);

    // Wait for nodes to load, then click in the sidebar nav
    await expect(page.getByText("Click Target Node")).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="knowledge-nav"]').getByText("Click Target Node").click();

    // Detail panel should open with the node's content
    await expect(page.locator('[data-testid="knowledge-detail-panel"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="knowledge-detail-panel"]')).toContainText("Click Target Node");
    await expect(page.locator('[data-testid="knowledge-detail-panel"]')).toContainText("This content should appear in the detail panel");
  });

  test("search filters knowledge nodes", async ({ appPage, grackle: { client } }) => {
    await skipIfKnowledgeUnavailable(client);
    const page = appPage;

    // Seed two distinct knowledge nodes
    const wsId = await createWorkspace(client, "kg-search");
    await client.createKnowledgeNode({
      title: "Unique Alpha Topic",
      content: "Content specifically about alpha concepts",
      category: "concept",
      tags: [],
      workspaceId: wsId,
    });
    await client.createKnowledgeNode({
      title: "Unique Beta Topic",
      content: "Content specifically about beta concepts",
      category: "decision",
      tags: [],
      workspaceId: wsId,
    });

    // Navigate to Knowledge tab
    await page.locator('[data-testid="sidebar-tab-knowledge"]').click();
    await page.locator('[data-testid="knowledge-page"]').waitFor({ timeout: 5_000 });

    // Filter to workspace to isolate from other tests
    await page.locator('[data-testid="knowledge-workspace-filter"]').selectOption(wsId);

    // Wait for nodes to load
    await expect(page.getByText("Unique Alpha Topic")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Unique Beta Topic")).toBeVisible();

    // Search for "Alpha"
    await page.locator('[data-testid="knowledge-search-input"]').fill("Alpha");
    await page.locator('[data-testid="knowledge-search-input"]').press("Enter");

    // The search results should include the Alpha node
    await expect(page.locator('[data-testid="knowledge-nav"]')).toContainText("Unique Alpha Topic", { timeout: 10_000 });
  });
});
