import { test, expect } from "./fixtures.js";

test.describe("Task Lifecycle (stub runtime)", () => {
  test("full task flow: create, start, stream, review, approve", async ({ appPage }) => {
    const page = appPage;

    // --- Step 1: Create a project ---
    await page.locator("button", { hasText: "+" }).first().click();
    const nameInput = page.locator('input[placeholder="Project name..."]');
    await nameInput.fill("lifecycle-proj");
    await page.locator("button", { hasText: "OK" }).click();
    await expect(page.getByText("lifecycle-proj")).toBeVisible({ timeout: 5_000 });

    // --- Step 2: Create a task with test-local environment ---
    await page.getByText("lifecycle-proj").click();
    await page.getByText("lifecycle-proj").locator("..").locator('button[title="New task"]').first().click();
    await page.locator('input[placeholder="Task title..."]').fill("test task");
    await page.locator("select").selectOption("test-local");
    await page.locator("button", { hasText: /^Create$/ }).click();
    await expect(page.getByText("test task")).toBeVisible({ timeout: 5_000 });

    // --- Step 3: Navigate to task view ---
    await page.getByText("test task").click();
    await expect(page.getByText("Task: test task")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="task-status"]')).toContainText("pending");
    // Overview tab should be active for pending task
    await expect(page.locator("button", { hasText: "Overview" })).toHaveAttribute("class", /active/);

    // --- Step 4: Monkey-patch WS to force stub runtime on start_task ---
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

    // --- Step 5: Click "Start Task" ---
    await page.locator("button", { hasText: "Start Task" }).click();

    // --- Step 6: Verify stub runtime events stream in ---
    // System event: "Stub runtime initialized"
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 15_000 });

    // Echo event: "Echo: test task"
    await expect(page.locator("text=Echo: test task")).toBeVisible();

    // Task header should show in_progress status
    await expect(page.locator('[data-testid="task-status"]')).toContainText("in_progress", { timeout: 5_000 });

    // --- Step 7: Session reaches waiting_input — send input ---
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 15_000 });
    await inputField.fill("continue work");
    await page.locator("button", { hasText: "Send" }).click();

    // --- Step 8: Session completes -> task auto-moves to review ---
    // The stub runtime completes quickly after input, auto-moving to review.
    // The SessionPanel auto-switches to the Stream tab on review, so we check
    // for the Approve button rather than stream content.
    await expect(page.locator("button", { hasText: "Approve" })).toBeVisible({ timeout: 15_000 });

    // UnifiedBar shows Approve and Reject buttons
    await expect(page.locator("button", { hasText: "Approve" })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("button", { hasText: "Reject" })).toBeVisible();

    // --- Step 9: Approve the task ---
    await page.locator("button", { hasText: "Approve" }).click();

    // Task status changes to done
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 5_000 });

    // "+ New Task" button appears
    await expect(page.locator("button", { hasText: "+ New Task" })).toBeVisible();
  });

  test("task rejection sends back to assigned status", async ({ appPage }) => {
    const page = appPage;

    // --- Create project and task ---
    await page.locator("button", { hasText: "+" }).first().click();
    const nameInput = page.locator('input[placeholder="Project name..."]');
    await nameInput.fill("reject-proj");
    await page.locator("button", { hasText: "OK" }).click();
    await expect(page.getByText("reject-proj")).toBeVisible({ timeout: 5_000 });

    await page.getByText("reject-proj").click();
    await page.getByText("reject-proj").locator("..").locator('button[title="New task"]').first().click();
    await page.locator('input[placeholder="Task title..."]').fill("reject task");
    await page.locator("select").selectOption("test-local");
    await page.locator("button", { hasText: /^Create$/ }).click();
    await expect(page.getByText("reject task")).toBeVisible({ timeout: 5_000 });

    // Navigate to task
    await page.getByText("reject task").click();
    await expect(page.getByText("Task: reject task")).toBeVisible({ timeout: 5_000 });

    // Monkey-patch WS for stub runtime
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
          } catch { /* not JSON */ }
        }
        return origSend.call(this, data);
      };
    });

    // Start task
    await page.locator("button", { hasText: "Start Task" }).click();

    // Wait for waiting_input and send input to complete the stub session
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 15_000 });
    await inputField.fill("done");
    await page.locator("button", { hasText: "Send" }).click();

    // Wait for review state
    await expect(page.locator("button", { hasText: "Approve" })).toBeVisible({ timeout: 15_000 });

    // Type rejection notes and click Reject
    const rejectInput = page.locator('input[placeholder="Rejection notes (optional)..."]');
    await rejectInput.fill("needs more tests");
    await page.locator("button", { hasText: "Reject" }).click();

    // Task should go back to assigned/pending — "Start Task" reappears
    await expect(page.locator("button", { hasText: "Start Task" })).toBeVisible({ timeout: 10_000 });
  });
});
