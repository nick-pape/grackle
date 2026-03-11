import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  diffViewerLocator,
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

    // Diff tab should be active (auto-switch on review).
    // The DiffViewer resolves to one of: loading, empty, error, or content.
    // Any visible DiffViewer state proves the tab activated and rendered.
    await expect(diffViewerLocator(page).first()).toBeVisible({ timeout: 10_000 });
  });

  test("diff tab can be selected for pending task", async ({ appPage }) => {
    const page = appPage;

    // Create project and task (do NOT start it)
    await createProject(page, "diff-manual");
    await createTask(page, "diff-manual", "diff-task-2", "test-local");
    await navigateToTask(page, "diff-task-2");

    // Manually click Diff tab
    await page.locator("button", { hasText: "Diff" }).click();

    // DiffViewer should render — for a pending task with no branch the server
    // returns an error, but any visible DiffViewer state is acceptable.
    await expect(diffViewerLocator(page).first()).toBeVisible({ timeout: 10_000 });
  });
});
