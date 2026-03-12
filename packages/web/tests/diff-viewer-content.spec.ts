import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  navigateToTask,
  getProjectId,
  getTaskId,
  injectWsMessage,
  installWsTracker,
} from "./helpers.js";

/** Realistic unified diff for test injection. */
const MOCK_DIFF = `diff --git a/src/utils.ts b/src/utils.ts
index abc1234..def5678 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -10,7 +10,9 @@ export function parseInput(raw: string): ParsedInput {
   const trimmed = raw.trim();
-  if (!trimmed) return null;
+  if (!trimmed) {
+    return { value: "", valid: false };
+  }
   return { value: trimmed, valid: true };
 }
@@ -25,3 +27,8 @@ export function formatOutput(data: ParsedInput): string {
   return data.value.toUpperCase();
 }
+
+/** Validates that the input meets minimum length requirements. */
+export function validateLength(input: string, min: number): boolean {
+  return input.length >= min;
+}`;

const MOCK_CHANGED_FILES = ["src/utils.ts", "src/index.ts", "README.md"];

test.describe("Diff Viewer Content", () => {
  test("diff viewer renders additions and deletions with correct styling", async ({ page }) => {
    // Install WS tracker BEFORE navigating so we can inject messages later
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Create project and task
    await createProject(page, "diff-content");
    await createTask(page, "diff-content", "diff-styled", "test-local");
    await navigateToTask(page, "diff-styled");

    // Switch to Diff tab
    await page.locator("button", { hasText: "Diff" }).click();

    // Get the task ID for injecting the diff message
    const projectId = await getProjectId(page, "diff-content");
    const taskId = await getTaskId(page, projectId, "diff-styled");

    // Inject a mock task_diff WS message via the tracked socket
    await injectWsMessage(page, {
      type: "task_diff",
      payload: {
        taskId,
        branch: "diff-content/diff-styled",
        diff: MOCK_DIFF,
        changedFiles: MOCK_CHANGED_FILES,
        additions: 7,
        deletions: 1,
      },
    });

    // Verify stats bar shows branch name (use exact to avoid matching task header)
    await expect(
      page.getByText("diff-content/diff-styled", { exact: true }),
    ).toBeVisible({ timeout: 5_000 });

    // Verify file count and stats (use exact match to avoid collisions with diff content)
    await expect(page.getByText("Files:")).toBeVisible();
    await expect(page.getByText("+7", { exact: true })).toBeVisible();
    await expect(page.getByText("-1", { exact: true })).toBeVisible();

    // Target diff line elements specifically (they use the diffLine CSS module class)
    const diffLine = (text: string) =>
      page.locator('div[class*="diffLine"]').filter({ hasText: text });

    // Verify added lines have green color (#4ecca3 = rgb(78, 204, 163))
    const addedLine = diffLine("+    return { value:");
    await expect(addedLine.first()).toBeVisible({ timeout: 5_000 });
    await expect(addedLine.first()).toHaveCSS("color", "rgb(78, 204, 163)");

    // Verify removed lines have red color (#e94560 = rgb(233, 69, 96))
    const removedLine = diffLine("-  if (!trimmed) return null;");
    await expect(removedLine.first()).toBeVisible();
    await expect(removedLine.first()).toHaveCSS("color", "rgb(233, 69, 96)");

    // Verify hunk headers have blue color (#70a1ff = rgb(112, 161, 255))
    const hunkLine = diffLine("@@ -10,7 +10,9 @@");
    await expect(hunkLine.first()).toBeVisible();
    await expect(hunkLine.first()).toHaveCSS("color", "rgb(112, 161, 255)");
  });

  test("diff viewer renders file list", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Create project and task
    await createProject(page, "diff-files");
    await createTask(page, "diff-files", "diff-flist", "test-local");
    await navigateToTask(page, "diff-flist");

    // Switch to Diff tab
    await page.locator("button", { hasText: "Diff" }).click();

    // Get taskId for injection
    const projectId = await getProjectId(page, "diff-files");
    const taskId = await getTaskId(page, projectId, "diff-flist");

    // Inject mock diff with specific file list
    const fileList = ["src/components/Header.tsx", "src/api/routes.ts", "package.json", "tsconfig.json"];
    await injectWsMessage(page, {
      type: "task_diff",
      payload: {
        taskId,
        branch: "diff-files/diff-flist",
        diff: "diff --git a/src/components/Header.tsx b/src/components/Header.tsx\n+// placeholder",
        changedFiles: fileList,
        additions: 1,
        deletions: 0,
      },
    });

    // Verify all file names appear in the file list section (exact match to avoid diff content)
    for (const fileName of fileList) {
      await expect(page.getByText(fileName, { exact: true })).toBeVisible({ timeout: 5_000 });
    }
  });

  test("diff viewer shows empty state for no-change branch", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Create project and task
    await createProject(page, "diff-empty");
    await createTask(page, "diff-empty", "diff-nochange", "test-local");
    await navigateToTask(page, "diff-nochange");

    // Switch to Diff tab
    await page.locator("button", { hasText: "Diff" }).click();

    // Get taskId
    const projectId = await getProjectId(page, "diff-empty");
    const taskId = await getTaskId(page, projectId, "diff-nochange");

    // Inject mock diff with empty diff string
    await injectWsMessage(page, {
      type: "task_diff",
      payload: {
        taskId,
        branch: "diff-empty/diff-nochange",
        diff: "",
        changedFiles: [],
        additions: 0,
        deletions: 0,
      },
    });

    // Verify "no changes" empty state message
    await expect(
      page.getByText("The agent completed this task without modifying files"),
    ).toBeVisible({ timeout: 5_000 });
  });
});
