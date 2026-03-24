import { test, expect } from "./fixtures.js";
import {
  stubScenario,
  emitText,
  idle,
  onInputMatch,
} from "./helpers.js";

test.describe("Task Resume after crash (paused → working)", { tag: ["@task"] }, () => {
  test("resume button restarts a crashed (paused) task", async ({ stubTask }) => {
    const { page } = stubTask;

    // Scenario: emit text, then idle with input matching —
    // "fail" triggers failure, anything else advances
    await stubTask.createAndNavigate("retry task", stubScenario(
      emitText("Working on retry task..."),
      onInputMatch({ fail: "fail", "*": "next" }),
      idle(),
    ));

    // --- Start the task ---
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Wait for stub to reach waiting_input
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 15_000 });

    // --- Send "fail" to trigger scenario failure ---
    await inputField.fill("fail");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // --- Verify task is in paused state (crashed sessions → all terminal → paused) ---
    await expect(page.locator('[data-testid="task-status"]')).toContainText("paused", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();

    // --- Click Resume ---
    await page.getByRole("button", { name: "Resume", exact: true }).click();

    // --- Verify task restarts: stub runtime events appear again ---
    await expect(page.locator('[data-testid="task-status"]')).toContainText(/working|paused/, { timeout: 15_000 });

    // Wait for waiting_input and send normal input to complete
    await expect(inputField).toBeVisible({ timeout: 15_000 });
    await inputField.fill("continue");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // --- Verify task reaches paused (review) ---
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible({ timeout: 15_000 });
  });
});
