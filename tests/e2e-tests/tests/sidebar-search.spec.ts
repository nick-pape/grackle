import { test } from "./fixtures.js";

/**
 * Sidebar search filter tests are skipped because the sidebar no longer shows
 * workspaces. The sidebar now shows environment navigation (EnvironmentNav)
 * and a global task list (TaskList), neither of which has the workspace search
 * filter that these tests were exercising. The search functionality would need
 * to be reimplemented (e.g., in the TaskList sidebar) before these tests can
 * be rewritten.
 */
test.describe("Sidebar search filter", () => {
  test.skip("search input is visible when workspaces exist", async () => {
    // Skipped: sidebar no longer contains workspace search
  });

  test.skip("typing filters workspaces by name", async () => {
    // Skipped: sidebar no longer contains workspace search
  });

  test.skip("typing filters tasks by title", async () => {
    // Skipped: sidebar no longer contains workspace search
  });

  test.skip("clearing filter restores full list", async () => {
    // Skipped: sidebar no longer contains workspace search
  });

  test.skip("search works in grouped-by-status view", async () => {
    // Skipped: sidebar no longer contains workspace search
  });

  test.skip("matching text in task titles is highlighted", async () => {
    // Skipped: sidebar no longer contains workspace search
  });

  test.skip("workspace match shows all its tasks", async () => {
    // Skipped: sidebar no longer contains workspace search
  });

  test.skip("search finds tasks in unexpanded workspaces", async () => {
    // Skipped: sidebar no longer contains workspace search
  });
});
