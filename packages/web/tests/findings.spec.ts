import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  navigateToTask,
  getProjectId,
  getTaskId,
  sendWsMessage,
} from "./helpers.js";

test.describe("Findings", () => {
  test("post finding and see it in Findings tab", async ({ appPage }) => {
    const page = appPage;

    // Create project and task
    await createProject(page, "find-single");
    await createTask(page, "find-single", "find-task-1", "test-local");

    // Get IDs for posting a finding
    const projectId = await getProjectId(page, "find-single");
    const taskId = await getTaskId(page, projectId, "find-task-1");

    // Post a finding via WS
    await sendWsMessage(page, {
      type: "post_finding",
      payload: {
        projectId,
        taskId,
        category: "bug",
        title: "Found a null pointer issue",
        content: "The handler at line 42 dereferences a null value when input is empty.",
        tags: ["critical", "backend"],
      },
    });

    // Navigate to task and switch to Findings tab
    await navigateToTask(page, "find-task-1");
    await page.locator("button", { hasText: "Findings" }).click();

    // Verify finding card renders with title, category badge, and content
    await expect(page.getByText("Found a null pointer issue")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("bug")).toBeVisible();
    await expect(page.getByText("The handler at line 42")).toBeVisible();

    // Verify tags render
    await expect(page.getByText("critical")).toBeVisible();
    await expect(page.getByText("backend")).toBeVisible();
  });

  test("multiple findings with different categories render correctly", async ({ appPage }) => {
    const page = appPage;

    // Create project and task
    await createProject(page, "find-multi");
    await createTask(page, "find-multi", "find-task-2", "test-local");

    const projectId = await getProjectId(page, "find-multi");
    const taskId = await getTaskId(page, projectId, "find-task-2");

    // Post 3 findings with different categories
    await sendWsMessage(page, {
      type: "post_finding",
      payload: {
        projectId,
        taskId,
        category: "bug",
        title: "Memory leak in cache",
        content: "Cache entries are never evicted.",
        tags: [],
      },
    });

    await sendWsMessage(page, {
      type: "post_finding",
      payload: {
        projectId,
        taskId,
        category: "architecture",
        title: "Consider event sourcing",
        content: "The current approach stores only final state.",
        tags: ["design"],
      },
    });

    await sendWsMessage(page, {
      type: "post_finding",
      payload: {
        projectId,
        taskId,
        category: "general",
        title: "Code style note",
        content: "Inconsistent naming in utils module.",
        tags: [],
      },
    });

    // Navigate to task → Findings tab
    await navigateToTask(page, "find-task-2");
    await page.locator("button", { hasText: "Findings" }).click();

    // Verify all 3 findings render
    await expect(page.getByText("Memory leak in cache")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Consider event sourcing")).toBeVisible();
    await expect(page.getByText("Code style note")).toBeVisible();

    // Verify category badges
    await expect(page.getByText("bug")).toBeVisible();
    await expect(page.getByText("architecture")).toBeVisible();
    await expect(page.getByText("general")).toBeVisible();
  });

  test("findings persist across tab switches", async ({ appPage }) => {
    const page = appPage;

    // Create project and task
    await createProject(page, "find-persist");
    await createTask(page, "find-persist", "find-task-3", "test-local");

    const projectId = await getProjectId(page, "find-persist");
    const taskId = await getTaskId(page, projectId, "find-task-3");

    // Post a finding
    await sendWsMessage(page, {
      type: "post_finding",
      payload: {
        projectId,
        taskId,
        category: "decision",
        title: "Use PostgreSQL over MySQL",
        content: "Better JSON support and ACID compliance.",
        tags: ["database"],
      },
    });

    // Navigate to task → Findings tab
    await navigateToTask(page, "find-task-3");
    await page.locator("button", { hasText: "Findings" }).click();
    await expect(page.getByText("Use PostgreSQL over MySQL")).toBeVisible({ timeout: 5_000 });

    // Switch to Stream tab
    await page.locator("button", { hasText: "Stream" }).click();
    await expect(page.locator("button", { hasText: "Start" }).first()).toBeVisible();

    // Switch back to Findings tab — finding should still be there
    await page.locator("button", { hasText: "Findings" }).click();
    await expect(page.getByText("Use PostgreSQL over MySQL")).toBeVisible({ timeout: 5_000 });
  });
});
