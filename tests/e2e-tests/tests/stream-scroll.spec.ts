import { test, expect } from "./fixtures.js";
import {
  createWorkspace,
  createTaskWithScenario,
  navigateToTask,
  patchWsForStubRuntime,
  installWsTracker,
  stubScenario,
  emitText,
  emitToolUse,
  emitToolResult,
  idle,
  onInput,
} from "./helpers.js";

/** Scenario with enough events to produce scrollable content. */
function scrollableScenario(): { steps: ReturnType<typeof emitText>[] } {
  return stubScenario(
    emitText("Line 1 of output"),
    emitText("Line 2 of output"),
    emitText("Line 3 of output"),
    emitToolUse("read_file", { path: "/some/long/path" }),
    emitToolResult("File contents that span multiple lines\nLine 2\nLine 3\nLine 4\nLine 5"),
    emitText("Line 4 of output"),
    emitText("Line 5 of output"),
    onInput("next"),
    idle(),
  );
}

/** Start task, wait for idle, send input to complete. */
async function runScenarioToCompletion(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const inputField = page.locator('input[placeholder="Type a message..."]');
  await inputField.waitFor({ timeout: 15_000 });
  await inputField.fill("continue");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).waitFor({ timeout: 15_000 });
}

test.describe("Stream smart scroll", { tag: ["@webui"] }, () => {
  test("scrolled to bottom on initial load with events", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "scroll-init");
    await createTaskWithScenario(page, "scroll-init", "init-task", scrollableScenario());
    await navigateToTask(page, "init-task");
    await patchWsForStubRuntime(page);
    await runScenarioToCompletion(page);

    // Switch to stream tab
    await page.locator("button", { hasText: "Stream" }).click();

    // Verify scroll container exists and is scrolled near the bottom
    const scrollContainer = page.getByTestId("event-stream-scroll");
    await expect(scrollContainer).toBeVisible();

    const isNearBottom = await scrollContainer.evaluate((el) => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      return distanceFromBottom < 60;
    });
    expect(isNearBottom).toBe(true);
  });

  test("direction toggle reverses event order", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "scroll-dir");
    await createTaskWithScenario(page, "scroll-dir", "dir-task", scrollableScenario());
    await navigateToTask(page, "dir-task");
    await patchWsForStubRuntime(page);
    await runScenarioToCompletion(page);

    await page.locator("button", { hasText: "Stream" }).click();
    const scrollContainer = page.getByTestId("event-stream-scroll");
    await expect(scrollContainer).toBeVisible();

    // Get text content before toggle
    const textBefore = await scrollContainer.innerText();

    // Click direction toggle
    const toggle = page.getByTestId("direction-toggle");
    await expect(toggle).toBeVisible();
    await toggle.click();

    // Get text content after toggle — should be different (reversed order)
    const textAfter = await scrollContainer.innerText();
    expect(textBefore).not.toEqual(textAfter);
  });

  test("scroll-to-anchor FAB appears when scrolled away", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    await createWorkspace(page, "scroll-fab");
    await createTaskWithScenario(page, "scroll-fab", "fab-task", scrollableScenario());
    await navigateToTask(page, "fab-task");
    await patchWsForStubRuntime(page);
    await runScenarioToCompletion(page);

    await page.locator("button", { hasText: "Stream" }).click();
    const scrollContainer = page.getByTestId("event-stream-scroll");
    await expect(scrollContainer).toBeVisible();

    // Scroll to the very top (away from anchor)
    await scrollContainer.evaluate((el) => {
      el.scrollTop = 0;
    });

    // Wait a moment for scroll event to fire
    await page.waitForTimeout(300);

    // FAB should appear if there's enough content to scroll
    const hasScrollableContent = await scrollContainer.evaluate(
      (el) => el.scrollHeight > el.clientHeight + 60,
    );

    if (hasScrollableContent) {
      const fab = page.getByTestId("scroll-to-anchor");
      await expect(fab).toBeVisible({ timeout: 2_000 });

      // Click FAB, verify it scrolls back to bottom and disappears
      await fab.click();
      await page.waitForTimeout(500);

      const isNearBottom = await scrollContainer.evaluate((el) => {
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        return distanceFromBottom < 60;
      });
      expect(isNearBottom).toBe(true);

      await expect(fab).not.toBeVisible({ timeout: 2_000 });
    }
  });
});
