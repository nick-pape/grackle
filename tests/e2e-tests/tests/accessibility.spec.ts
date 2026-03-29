import { test, expect } from "./fixtures.js";
import type { Page } from "@playwright/test";
import {
  createWorkspace,
  createTask,
  getWorkspaceId,
  getTaskId,
  createTaskDirect,
  stubScenario,
  idle,
  patchWsForStubRuntime,
} from "./helpers.js";

/** Navigate to the Tasks sidebar tab. */
async function goToTasksTab(page: Page): Promise<void> {
  await page.locator('[data-testid="sidebar-tab-tasks"]').click();
}

/** Navigate to the Knowledge tab and wait for the page to load. */
async function navigateToKnowledge(page: Page): Promise<void> {
  await page.locator('[data-testid="sidebar-tab-knowledge"]').click();
  await page.locator('[data-testid="knowledge-page"]').waitFor({ timeout: 5_000 });
}

test.describe("Accessibility attributes", { tag: ["@a11y"] }, () => {
  test.describe("TaskList row accessibility", () => {
    test("task rows in tree view have role=button, tabIndex, and keyboard support", async ({ appPage, grackle: { client } }) => {
      const page = appPage;

      // Create workspace with parent + child tasks
      await createWorkspace(client, "a11y-tree");
      await createTask(client, "a11y-tree", "a11y-parent", "test-local", { canDecompose: true });

      await goToTasksTab(page);

      const workspaceId = await getWorkspaceId(client, "a11y-tree");
      const parentId = await getTaskId(client, workspaceId, "a11y-parent");
      await createTaskDirect(client, workspaceId, "a11y-child", { parentTaskId: parentId });

      // Wait for child to appear (auto-expand)
      await expect(page.getByText("a11y-child")).toBeVisible({ timeout: 5_000 });

      // Assert parent row has role="button", tabIndex, and aria-label
      const parentRow = page.locator(`[data-task-id="${parentId}"]`);
      await expect(parentRow).toHaveAttribute("role", "button");
      await expect(parentRow).toHaveAttribute("tabindex", "0");
      await expect(parentRow).toHaveAttribute("aria-label", "a11y-parent");

      // Assert child row has role="button", tabIndex, and aria-label
      const childId = await getTaskId(client, workspaceId, "a11y-child");
      const childRow = page.locator(`[data-task-id="${childId}"]`);
      await expect(childRow).toHaveAttribute("role", "button");
      await expect(childRow).toHaveAttribute("tabindex", "0");
      await expect(childRow).toHaveAttribute("aria-label", "a11y-child");

      // Keyboard navigation: pressing Enter on child row navigates to task page
      await childRow.focus();
      await childRow.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/tasks/${childId}`), { timeout: 5_000 });
    });

    test("task rows in status-group view have role=button, tabIndex, and keyboard support", async ({ appPage, grackle: { client } }) => {
      const page = appPage;

      await createWorkspace(client, "a11y-status");
      await createTask(client, "a11y-status", "a11y-status-task", "test-local");

      await goToTasksTab(page);

      // Toggle to status-group view (click the group toggle button)
      const groupToggle = page.locator('[aria-label="Group tasks by status"]');
      await expect(groupToggle).toBeVisible({ timeout: 5_000 });
      await groupToggle.click();

      // Wait for status group to render
      const workspaceId = await getWorkspaceId(client, "a11y-status");
      const taskId = await getTaskId(client, workspaceId, "a11y-status-task");
      const taskRow = page.locator(`[data-task-id="${taskId}"]`);
      await expect(taskRow).toBeVisible({ timeout: 5_000 });

      // Assert row has accessibility attributes including aria-label
      await expect(taskRow).toHaveAttribute("role", "button");
      await expect(taskRow).toHaveAttribute("tabindex", "0");
      await expect(taskRow).toHaveAttribute("aria-label", "a11y-status-task");

      // Keyboard navigation: pressing Enter navigates to task page
      await taskRow.focus();
      await taskRow.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}`), { timeout: 5_000 });
    });
  });

  test.describe("ChatInput aria-labels", () => {
    test("chat input in send mode has aria-label", async ({ stubTask }) => {
      const { page } = stubTask;

      // Create and navigate to a task that goes idle (shows send-mode input)
      await stubTask.createAndNavigate("a11y-chat-send", stubScenario(idle()));

      // Start the task
      await page.getByTestId("task-header-start").click();

      // Wait for input to appear
      const input = page.locator('input[placeholder="Type a message..."]');
      await expect(input).toBeVisible({ timeout: 15_000 });

      // Assert aria-label
      await expect(input).toHaveAttribute("aria-label");
    });

    test("chat input in spawn mode has aria-label on input", async ({ appPage }) => {
      const page = appPage;

      // Navigate to chat page — the spawn-mode input should be visible
      await page.getByTestId("sidebar-tab-chat").click();
      await expect(page).toHaveURL(/\/chat/);

      // Wait for the spawn-mode input (uses "Enter prompt..." or "Type a message..." placeholder)
      const input = page.locator('input[placeholder="Enter prompt..."]');
      // The input may not be visible if there's no environment — fall back to other placeholder
      const altInput = page.locator('input[placeholder="Type a message..."]');
      const spawnInput = await input.isVisible().catch(() => false) ? input : altInput;
      await expect(spawnInput).toBeVisible({ timeout: 5_000 });

      // Assert aria-label on input
      await expect(spawnInput).toHaveAttribute("aria-label");

      // Assert persona select has aria-label (if visible — only shown when showPersonaSelect is true)
      const personaSelect = page.locator('select[aria-label="Select persona"]');
      const selectVisible = await personaSelect.isVisible().catch(() => false);
      if (selectVisible) {
        await expect(personaSelect).toHaveAttribute("aria-label", "Select persona");
      }
    });
  });

  test.describe("KnowledgeNav aria-labels", () => {
    /** Probe knowledge availability. Skip if unavailable. */
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

    test("knowledge search input and workspace filter have aria-labels", async ({ appPage, grackle: { client } }) => {
      await skipIfKnowledgeUnavailable(client);
      await navigateToKnowledge(appPage);

      const nav = appPage.locator('[data-testid="knowledge-nav"]');
      await expect(nav).toBeVisible({ timeout: 5_000 });

      // Search input should have aria-label
      const searchInput = nav.locator('[data-testid="knowledge-search-input"]');
      await expect(searchInput).toHaveAttribute("aria-label");

      // Workspace filter select should have aria-label
      const workspaceSelect = nav.locator("select");
      await expect(workspaceSelect).toHaveAttribute("aria-label");
    });
  });
});
