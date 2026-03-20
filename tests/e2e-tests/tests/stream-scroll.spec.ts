import { test, expect } from "./fixtures.js";
import {
  clickSidebarWorkspace,
  createWorkspace,
  createTask,
  navigateToTask,
  patchWsForStubRuntime,
  runStubTaskToCompletion,
  installWsTracker,
  injectWsMessage,
} from "./helpers.js";

test.describe("Stream smart scroll", () => {
  test("scrolled to bottom on initial load with events", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "scroll-init");
    await clickSidebarWorkspace(page, "scroll-init");
    await createTask(page, "scroll-init", "init-task", "test-local");
    await navigateToTask(page, "init-task");
    await patchWsForStubRuntime(page);
    await runStubTaskToCompletion(page);

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
    await clickSidebarWorkspace(page, "scroll-dir");
    await createTask(page, "scroll-dir", "dir-task", "test-local");
    await navigateToTask(page, "dir-task");
    await patchWsForStubRuntime(page);
    await runStubTaskToCompletion(page);

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

  test("scroll-to-anchor FAB appears when scrolled away", async ({ page, baseURL }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    await createWorkspace(page, "scroll-fab");
    await clickSidebarWorkspace(page, "scroll-fab");
    await createTask(page, "scroll-fab", "fab-task", "test-local");
    await navigateToTask(page, "fab-task");
    await patchWsForStubRuntime(page);
    await runStubTaskToCompletion(page);

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
