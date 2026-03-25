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
  await page.getByTestId("task-header-start").click();
  const inputField = page.locator('input[placeholder="Type a message..."]');
  await inputField.waitFor({ timeout: 15_000 });
  await inputField.fill("continue");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).waitFor({ timeout: 15_000 });
}

test.describe("Stream smart scroll", { tag: ["@webui"] }, () => {
  test("scrolled to bottom on initial load with events", async ({ stubTask }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigate("init-task", scrollableScenario());
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

  test("direction toggle reverses event order", async ({ stubTask }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigate("dir-task", scrollableScenario());
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

  test("scroll-to-anchor FAB appears when scrolled away", async ({ page, grackle: { client } }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    await createWorkspace(client, "scroll-fab");
    await createTaskWithScenario(client, "scroll-fab", "fab-task", scrollableScenario());
    await navigateToTask(page, "fab-task");
    await patchWsForStubRuntime(page);
    await runScenarioToCompletion(page);

    await page.locator("button", { hasText: "Stream" }).click();
    const scrollContainer = page.getByTestId("event-stream-scroll");
    await expect(scrollContainer).toBeVisible();

    // Check if there's enough content to produce a scrollbar
    const hasScrollableContent = await scrollContainer.evaluate(
      (el) => el.scrollHeight > el.clientHeight + 60,
    );

    if (hasScrollableContent) {
      // Scroll to the very top (away from anchor)
      await scrollContainer.evaluate((el) => {
        el.scrollTop = 0;
      });

      // FAB should appear once the scroll event fires (auto-retries)
      const fab = page.getByTestId("scroll-to-anchor");
      await expect(fab).toBeVisible({ timeout: 2_000 });

      // Click FAB, wait for scroll animation to reach the bottom
      await fab.click();
      await expect
        .poll(
          async () =>
            scrollContainer.evaluate(
              (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
            ),
          { timeout: 2_000 },
        )
        .toBeLessThan(60);

      await expect(fab).not.toBeVisible({ timeout: 2_000 });
    }
  });
});
