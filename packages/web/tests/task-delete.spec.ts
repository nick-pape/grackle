import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  navigateToTask,
} from "./helpers.js";

test.describe("Task deletion via UI", () => {
  test("delete button on pending task shows confirm and removes task", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "del-pending");
    await createTask(page, "del-pending", "pending-task", "test-local");

    // Navigate to the task to see its action bar
    await navigateToTask(page, "pending-task");

    // Should see Start Task and Delete buttons
    await expect(page.locator("button", { hasText: "Delete" })).toBeVisible({ timeout: 5_000 });

    // Set up dialog handler to accept the confirm
    page.once("dialog", (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("pending-task");
      return dialog.accept();
    });

    // Click delete
    await page.locator("button", { hasText: "Delete" }).click();

    // Task should disappear from sidebar
    await expect(page.getByText("pending-task")).not.toBeVisible({ timeout: 5_000 });

    // View should return to project (hint text visible)
    await expect(page.getByText("Select a task or click + to create one")).toBeVisible({ timeout: 5_000 });
  });

  test("delete confirm dialog can be cancelled", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "del-cancel");
    await createTask(page, "del-cancel", "cancel-task", "test-local");

    await navigateToTask(page, "cancel-task");

    // Dismiss the confirm dialog
    page.once("dialog", (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("cancel-task");
      return dialog.dismiss();
    });

    await page.locator("button", { hasText: "Delete" }).click();

    // Task should still be visible (deletion was cancelled)
    await expect(page.getByText("cancel-task")).toBeVisible({ timeout: 5_000 });

    // Should still be on the task view
    await expect(page.getByText("Task: cancel-task")).toBeVisible({ timeout: 5_000 });
  });
});
