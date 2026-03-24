import { test, expect } from "./fixtures.js";
import { runStubTaskToCompletion } from "./helpers.js";

test.describe("Session history", { tag: ["@session"] }, () => {
  test("single-session task hides attempt selector", async ({ stubTask }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigateSimple("simple-task");

    await runStubTaskToCompletion(page);
    await page.locator("button", { hasText: "Stream" }).click();
    await expect(page.locator("[data-testid='attempt-selector']")).not.toBeVisible();
  });
});
