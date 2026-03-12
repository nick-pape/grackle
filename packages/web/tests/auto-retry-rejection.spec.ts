import { test, expect } from "./fixtures.js";

test.describe("Auto-retry on rejection", () => {
  test("rejected task auto-retries with review notes and returns to review", async ({ appPage }) => {
    const page = appPage;

    // --- Step 1: Create a project ---
    await page.locator("button", { hasText: "+" }).first().click();
    const nameInput = page.locator('input[placeholder="Project name..."]');
    await nameInput.fill("auto-retry-proj");
    await page.locator("button", { hasText: "OK" }).click();
    await expect(page.getByText("auto-retry-proj")).toBeVisible({ timeout: 5_000 });

    // --- Step 2: Create a task ---
    await page.getByText("auto-retry-proj").click();
    await page.getByText("auto-retry-proj").locator("..").locator('button[title="New task"]').click();
    await page.locator('input[placeholder="Task title..."]').fill("retry task");
    await page.locator("select").selectOption("test-local");
    await page.locator("button", { hasText: "Create" }).click();
    await expect(page.getByText("retry task")).toBeVisible({ timeout: 5_000 });

    // --- Step 3: Navigate to task view ---
    await page.getByText("retry task").click();
    await expect(page.getByText("Task: retry task")).toBeVisible({ timeout: 5_000 });

    // --- Step 4: Monkey-patch WS to force stub runtime ---
    await page.evaluate(() => {
      const origSend = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data: string | ArrayBuffer | Blob | ArrayBufferView) {
        if (typeof data === "string") {
          try {
            const msg = JSON.parse(data);
            if (msg.type === "start_task") {
              msg.payload.runtime = "stub";
              data = JSON.stringify(msg);
            }
          } catch { /* not JSON, pass through */ }
        }
        return origSend.call(this, data);
      };
    });

    // --- Step 5: Start the task ---
    await page.locator("button", { hasText: "Start Task" }).click();

    // --- Step 6: Complete stub session to reach review ---
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 15_000 });
    await inputField.fill("initial work");
    await page.locator("button", { hasText: "Send" }).click();

    await expect(page.locator("button", { hasText: "Approve" })).toBeVisible({ timeout: 15_000 });

    // --- Step 7: Reject with review notes ---
    const rejectInput = page.locator('input[placeholder="Rejection notes (optional)..."]');
    await rejectInput.fill("add more tests");
    await page.locator("button", { hasText: "Reject" }).click();

    // --- Step 8: Verify auto-retry starts — stream events appear for new session ---
    // The stub runtime will reach waiting_input again
    const retryInput = page.locator('input[placeholder="Type a message..."]');
    await expect(retryInput).toBeVisible({ timeout: 15_000 });
    await retryInput.fill("added tests");
    await page.locator("button", { hasText: "Send" }).click();

    // --- Step 9: Verify task returns to review after retry ---
    await expect(page.locator("button", { hasText: "Approve" })).toBeVisible({ timeout: 15_000 });

    // --- Step 10: Verify no failure ---
    await expect(page.getByText("Task failed")).not.toBeVisible();

    // --- Step 11: Approve to finish ---
    await page.locator("button", { hasText: "Approve" }).click();
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 5_000 });
  });
});
