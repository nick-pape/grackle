import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  navigateToTask,
} from "./helpers.js";

test.describe("Task deletion via UI", () => {
  test("delete button on pending task shows confirm and removes task", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "tdel-confirm");
    await createTask(page, "tdel-confirm", "tdel-accept-task", "test-local");

    // Navigate to the task to see its action bar
    await navigateToTask(page, "tdel-accept-task");

    // Should see Start Task and Delete buttons
    await expect(page.locator("button", { hasText: "Delete" })).toBeVisible({ timeout: 5_000 });

    // Set up dialog handler to accept the confirm
    page.once("dialog", (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("tdel-accept-task");
      return dialog.accept();
    });

    // Click delete
    await page.locator("button", { hasText: "Delete" }).click();

    // Task should disappear from sidebar (use exact match in sidebar task title)
    const sidebarTask = page.locator('[class*="taskTitle"]', { hasText: "tdel-accept-task" });
    await expect(sidebarTask).not.toBeVisible({ timeout: 5_000 });
  });

  test("delete confirm dialog can be cancelled", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "tdel-dismiss");
    await createTask(page, "tdel-dismiss", "tdel-dismiss-task", "test-local");

    await navigateToTask(page, "tdel-dismiss-task");

    // Dismiss the confirm dialog
    page.once("dialog", (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("tdel-dismiss-task");
      return dialog.dismiss();
    });

    await page.locator("button", { hasText: "Delete" }).click();

    // Task should still be visible in sidebar (deletion was cancelled)
    const sidebarTask = page.locator('[class*="taskTitle"]', { hasText: "tdel-dismiss-task" });
    await expect(sidebarTask).toBeVisible({ timeout: 5_000 });

    // Should still be on the task view (header visible)
    await expect(page.getByText("Task: tdel-dismiss-task")).toBeVisible({ timeout: 5_000 });
  });
});
