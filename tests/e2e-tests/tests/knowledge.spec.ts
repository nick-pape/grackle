import { test, expect } from "./fixtures.js";
import { createWorkspace } from "./helpers.js";

test.describe("Knowledge Graph", { tag: ["@webui"] }, () => {
  test("knowledge page renders with empty state", async ({ appPage }) => {
    const page = appPage;

    // Navigate to Knowledge tab
    await page.locator('[data-testid="sidebar-tab-knowledge"]').click();
    await page.locator('[data-testid="knowledge-page"]').waitFor({ timeout: 5_000 });

    // Empty state message
    await expect(page.getByText("No knowledge nodes found.")).toBeVisible({ timeout: 5_000 });
  });

  test("knowledge page shows seeded nodes in nav and graph", async ({ appPage, grackle: { client } }) => {
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

    // Nodes should appear in the sidebar nav
    await expect(page.locator('[data-testid="knowledge-nav"]')).toContainText("Nodes (2)", { timeout: 10_000 });
    await expect(page.getByText("Auth Flow Design")).toBeVisible();
    await expect(page.getByText("Database Schema Choice")).toBeVisible();

    // Graph container should be visible with SVG content
    await expect(page.locator('[data-testid="knowledge-graph"]')).toBeVisible();
  });

  test("clicking a node opens the detail panel", async ({ appPage, grackle: { client } }) => {
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

    // Wait for nodes to load, then click in the sidebar nav
    await expect(page.getByText("Click Target Node")).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="knowledge-nav"]').getByText("Click Target Node").click();

    // Detail panel should open with the node's content
    await expect(page.locator('[data-testid="knowledge-detail-panel"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="knowledge-detail-panel"]')).toContainText("Click Target Node");
    await expect(page.locator('[data-testid="knowledge-detail-panel"]')).toContainText("This content should appear in the detail panel");
  });

  test("search filters knowledge nodes", async ({ appPage, grackle: { client } }) => {
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

    // Wait for both nodes to load
    await expect(page.locator('[data-testid="knowledge-nav"]')).toContainText("Nodes (2)", { timeout: 10_000 });

    // Search for "Alpha"
    await page.locator('[data-testid="knowledge-search-input"]').fill("Alpha");
    await page.locator('[data-testid="knowledge-search-input"]').press("Enter");

    // The search results should include the Alpha node
    await expect(page.locator('[data-testid="knowledge-nav"]')).toContainText("Unique Alpha Topic", { timeout: 10_000 });
  });
});
