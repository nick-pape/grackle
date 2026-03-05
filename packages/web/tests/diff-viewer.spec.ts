import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  navigateToTask,
  patchWsForStubRuntime,
  runStubTaskToCompletion,
} from "./helpers.js";

test.describe("Diff Viewer", () => {
  test("diff tab shows loading then result after task review", async ({ appPage }) => {
    const page = appPage;

    // Create project and task
    await createProject(page, "diff-review");
    await createTask(page, "diff-review", "diff-task-1", "test-local");
    await navigateToTask(page, "diff-task-1");

    // Complete the task to reach review state (which auto-switches to Diff tab)
    await patchWsForStubRuntime(page);
    await runStubTaskToCompletion(page);

    // Diff tab should be active (auto-switch on review)
    // The DiffViewer should show one of: loading → then error/empty/content
    // With stub runtime, there's no real git branch, so expect "Loading diff..." first
    // then a result (likely an error since the branch doesn't exist in a real repo)
    const diffContent = page.locator("text=Loading diff...").or(
      page.locator("text=No changes on branch"),
    ).or(
      // Error state — DiffViewer renders errors with the errorState CSS module class
      page.locator('[class*="errorState"]'),
    );

    // Verify SOME diff state renders (not stuck with no content)
    await expect(diffContent.first()).toBeVisible({ timeout: 10_000 });
  });

  test("diff tab can be selected for pending task", async ({ appPage }) => {
    const page = appPage;

    // Create project and task (do NOT start it)
    await createProject(page, "diff-manual");
    await createTask(page, "diff-manual", "diff-task-2", "test-local");
    await navigateToTask(page, "diff-task-2");

    // Manually click Diff tab
    await page.locator("button", { hasText: "Diff" }).click();

    // DiffViewer should show loading initially, then resolve to some state
    // For a pending task with a branch that doesn't exist, expect an error or "Loading diff..."
    const loadingOrResult = page.locator("text=Loading diff...").or(
      page.locator("text=No changes on branch"),
    ).or(
      // Error state — DiffViewer renders errors with the errorState CSS module class
      page.locator('[class*="errorState"]'),
    );
    await expect(loadingOrResult.first()).toBeVisible({ timeout: 10_000 });
  });
});
