/**
 * Tests for #400: Block message send when task environment is disconnected.
 *
 * When a task is in `waiting_input` state but its assigned environment is
 * disconnected, the Send button should be disabled and a Reconnect button
 * should appear inline so the user can re-establish the connection without
 * navigating away from the stream view.
 *
 * Strategy: all task/session/environment state is injected directly into the
 * running app's WebSocket `onmessage` handler via `injectWsMessage`.  This
 * avoids actually starting a task (which requires a functioning PowerLine
 * gRPC connection) and keeps the tests fast and hermetic.
 */
import { test, expect } from "./fixtures.js";
import {
  installWsTracker,
  injectWsMessage,
  createProject,
  createTaskViaWs,
  getProjectId,
  navigateToTask,
} from "./helpers.js";

test.describe("Disconnected environment blocks message send", () => {
  /**
   * Helper: set up the UI so it looks exactly like a task that is in the
   * `waiting_input` state with a disconnected environment — but without
   * actually starting a real task (which requires a live PowerLine gRPC
   * connection that is not available in all environments).
   *
   * The approach:
   * 1. Create a project + task (task creation via WS always works).
   * 2. Navigate to the task so the app is in `task` view mode.
   * 3. Inject a fake `sessions` message: one session with
   *    `status = "waiting_input"` and `environmentId = "test-local"`.
   * 4. Inject a fake `tasks` message: the same task but now with
   *    `status = "in_progress"` and `sessionId` pointing to the fake session.
   * 5. Inject an `environments` message marking `test-local` as disconnected.
   *
   * After step 5 the UnifiedBar renders the disconnected state:
   *   – input disabled
   *   – Reconnect button visible
   *   – Send button disabled
   */
  async function setupWaitingInputWithDisconnectedEnv(
    page: import("@playwright/test").Page,
    projectName: string,
    taskTitle: string,
  ): Promise<void> {
    // --- 1. Create project and task -----------------------------------------
    await createProject(page, projectName);

    // Expand the project in the sidebar so the task becomes visible after creation.
    await page.getByText(projectName).first().click();

    const projectId = await getProjectId(page, projectName);
    // createTaskViaWs returns the full task row from the server, including all
    // fields required by the app's `isTaskData` validator.
    const task = await createTaskViaWs(page, projectId, taskTitle, {
      environmentId: "test-local",
    });

    // Wait for the task to be visible in the sidebar, then click it.
    await page
      .getByText(taskTitle, { exact: true })
      .first()
      .waitFor({ timeout: 5_000 });
    await navigateToTask(page, taskTitle);

    // --- 2. Inject a waiting_input session -----------------------------------
    const fakeSessionId = `e2e-disc-${Date.now()}`;
    await injectWsMessage(page, {
      type: "sessions",
      payload: {
        sessions: [
          {
            id: fakeSessionId,
            environmentId: "test-local",
            runtime: "stub",
            status: "waiting_input",
            prompt: taskTitle,
            startedAt: new Date().toISOString(),
          },
        ],
      },
    });

    // --- 3. Inject task update: now in_progress with the session -------------
    // Supply every field that isTaskData validates to avoid silent drops.
    await injectWsMessage(page, {
      type: "tasks",
      payload: {
        projectId: task.projectId ?? projectId,
        tasks: [
          {
            id: task.id,
            projectId: task.projectId ?? projectId,
            title: task.title ?? taskTitle,
            description: task.description ?? "",
            status: "in_progress",
            branch: task.branch ?? "",
            latestSessionId: fakeSessionId,
            dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
            reviewNotes: task.reviewNotes ?? "",
            sortOrder: typeof task.sortOrder === "number" ? task.sortOrder : 0,
            createdAt: task.createdAt ?? new Date().toISOString(),
            parentTaskId: task.parentTaskId ?? "",
            depth: typeof task.depth === "number" ? task.depth : 0,
            childTaskIds: Array.isArray(task.childTaskIds)
              ? task.childTaskIds
              : [],
            canDecompose: task.canDecompose ?? false,
          },
        ],
      },
    });

    // --- 4. Inject disconnected environment ----------------------------------
    await injectWsMessage(page, {
      type: "environments",
      payload: {
        environments: [
          {
            id: "test-local",
            displayName: "test-local",
            adapterType: "local",
            defaultRuntime: "stub",
            status: "disconnected",
            bootstrapped: true,
          },
        ],
      },
    });

    // Reconnect button should now be visible — confirms all three injections
    // were processed by the app correctly.
    await page
      .locator('[data-testid="reconnect-btn"]')
      .waitFor({ state: "visible", timeout: 5_000 });
  }

  test("Send button is disabled when task environment is disconnected", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    await setupWaitingInputWithDisconnectedEnv(
      page,
      "disc-env-proj-1",
      "disc-env-task-1",
    );

    const sendBtn = page.locator("button", { hasText: "Send" });
    await expect(sendBtn).toBeDisabled({ timeout: 5_000 });

    // The text input should also be disabled so the user can't accidentally
    // type a message that they won't be able to send.
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeDisabled({ timeout: 5_000 });
  });

  test("Send button wrapper has explanatory title when environment is disconnected", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    await setupWaitingInputWithDisconnectedEnv(
      page,
      "disc-env-proj-2",
      "disc-env-task-2",
    );

    // The disabled Send button is wrapped in a <span title="..."> so the tooltip
    // is shown reliably even when the button is disabled (disabled elements don't
    // consistently fire hover events in all browsers).
    const sendBtn = page.locator("button", { hasText: "Send" });
    const sendBtnWrapper = sendBtn.locator("xpath=..");
    await expect(sendBtnWrapper).toHaveAttribute(
      "title",
      /unavailable/i,
      { timeout: 5_000 },
    );
  });

  test("disconnect hint text is visible when environment is disconnected", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    await setupWaitingInputWithDisconnectedEnv(
      page,
      "disc-env-proj-3",
      "disc-env-task-3",
    );

    await expect(
      page.locator('[data-testid="env-disconnect-hint"]'),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator('[data-testid="env-disconnect-hint"]'),
    ).toContainText(/unavailable/i);
  });

  test("Reconnect button is visible when environment is disconnected", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    await setupWaitingInputWithDisconnectedEnv(
      page,
      "disc-env-proj-4",
      "disc-env-task-4",
    );

    const reconnectBtn = page.locator('[data-testid="reconnect-btn"]');
    await expect(reconnectBtn).toBeVisible({ timeout: 5_000 });
    await expect(reconnectBtn).toContainText("Reconnect");
  });

  test("clicking Reconnect button sends provision_environment to server", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    await setupWaitingInputWithDisconnectedEnv(
      page,
      "disc-env-proj-5",
      "disc-env-task-5",
    );

    // Intercept outgoing WS messages to capture provision_environment.
    await page.evaluate(() => {
      const origSend = WebSocket.prototype.send;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__provisionCaptured__ = { value: false };
      WebSocket.prototype.send = function (
        data: string | ArrayBuffer | Blob | ArrayBufferView,
      ) {
        if (typeof data === "string") {
          try {
            const msg = JSON.parse(data);
            if (msg.type === "provision_environment") {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (window as any).__provisionCaptured__.value = true;
            }
          } catch { /* ignore */ }
        }
        return origSend.call(this, data);
      };
    });

    // Click the Reconnect button
    await page.locator('[data-testid="reconnect-btn"]').click();

    // Verify provision_environment was sent
    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__provisionCaptured__?.value === true,
      { timeout: 3_000 },
    );
  });

  test("Send button is disabled in session mode when environment is disconnected", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Spawn a real session using the stub runtime (no PowerLine gRPC needed).
    // Settings → click "+" on the environment card → select stub → submit.
    await page.locator('button[title="Settings"]').click();
    await page.locator('button[title="New chat"]').click();

    const runtimeSelect = page.locator('[data-testid="new-chat-runtime-select"]');
    await runtimeSelect.waitFor({ state: "visible", timeout: 5_000 });
    await runtimeSelect.selectOption("stub");

    const promptInput = page.locator('input[placeholder="Enter prompt..."]');
    await promptInput.fill("hello stub");
    await page.locator("button", { hasText: "Go" }).click();

    // Wait for the session to reach waiting_input state.
    await page
      .locator('input[placeholder="Type a message..."]')
      .waitFor({ state: "visible", timeout: 15_000 });

    // Inject a disconnected environment to simulate a connectivity drop.
    // The global test setup seeds "test-local" as the only environment, so
    // the stub session will always be running on that env ID.
    await injectWsMessage(page, {
      type: "environments",
      payload: {
        environments: [
          {
            id: "test-local",
            displayName: "test-local",
            adapterType: "local",
            defaultRuntime: "stub",
            status: "disconnected",
            bootstrapped: true,
          },
        ],
      },
    });

    // Reconnect button must appear, confirming the injection was processed.
    await page
      .locator('[data-testid="reconnect-btn"]')
      .waitFor({ state: "visible", timeout: 5_000 });

    const sendBtn = page.locator("button", { hasText: "Send" });
    await expect(sendBtn).toBeDisabled({ timeout: 5_000 });

    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeDisabled({ timeout: 5_000 });

    await expect(
      page.locator('[data-testid="env-disconnect-hint"]'),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("Send button re-enables when environment reconnects", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    await setupWaitingInputWithDisconnectedEnv(
      page,
      "disc-env-proj-6",
      "disc-env-task-6",
    );

    // Confirm Send is currently disabled
    const sendBtn = page.locator("button", { hasText: "Send" });
    await expect(sendBtn).toBeDisabled({ timeout: 5_000 });

    // Simulate environment reconnecting
    await injectWsMessage(page, {
      type: "environments",
      payload: {
        environments: [
          {
            id: "test-local",
            displayName: "test-local",
            adapterType: "local",
            defaultRuntime: "stub",
            status: "connected",
            bootstrapped: true,
          },
        ],
      },
    });

    // Input is now enabled — fill it so the only remaining gate is the env check.
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await inputField.fill("hello");

    // Send button should become enabled now that env is connected + text present
    await expect(sendBtn).toBeEnabled({ timeout: 5_000 });

    // Reconnect button and disconnect hint should be gone
    await expect(
      page.locator('[data-testid="reconnect-btn"]'),
    ).not.toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator('[data-testid="env-disconnect-hint"]'),
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test("Send button is disabled when task environment is in error state", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Set up the waiting_input state via WS injection
    await createProject(page, "disc-env-proj-err");
    await page.getByText("disc-env-proj-err").first().click();

    const projectId = await getProjectId(page, "disc-env-proj-err");
    const task = await createTaskViaWs(page, projectId, "disc-env-task-err", {
      environmentId: "test-local",
    });

    await page
      .getByText("disc-env-task-err", { exact: true })
      .first()
      .waitFor({ timeout: 5_000 });
    await navigateToTask(page, "disc-env-task-err");

    const fakeSessionId = `e2e-err-${Date.now()}`;
    await injectWsMessage(page, {
      type: "sessions",
      payload: {
        sessions: [
          {
            id: fakeSessionId,
            environmentId: "test-local",
            runtime: "stub",
            status: "waiting_input",
            prompt: "disc-env-task-err",
            startedAt: new Date().toISOString(),
          },
        ],
      },
    });

    await injectWsMessage(page, {
      type: "tasks",
      payload: {
        projectId: task.projectId ?? projectId,
        tasks: [
          {
            id: task.id,
            projectId: task.projectId ?? projectId,
            title: task.title ?? "disc-env-task-err",
            description: task.description ?? "",
            status: "in_progress",
            branch: task.branch ?? "",
            latestSessionId: fakeSessionId,
            dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
            reviewNotes: task.reviewNotes ?? "",
            sortOrder: typeof task.sortOrder === "number" ? task.sortOrder : 0,
            createdAt: task.createdAt ?? new Date().toISOString(),
            parentTaskId: task.parentTaskId ?? "",
            depth: typeof task.depth === "number" ? task.depth : 0,
            childTaskIds: Array.isArray(task.childTaskIds) ? task.childTaskIds : [],
            canDecompose: task.canDecompose ?? false,
          },
        ],
      },
    });

    // Inject environment in "error" state (not "disconnected")
    await injectWsMessage(page, {
      type: "environments",
      payload: {
        environments: [
          {
            id: "test-local",
            displayName: "test-local",
            adapterType: "local",
            defaultRuntime: "stub",
            status: "error",
            bootstrapped: true,
          },
        ],
      },
    });

    await page
      .locator('[data-testid="reconnect-btn"]')
      .waitFor({ state: "visible", timeout: 5_000 });

    const sendBtn = page.locator("button", { hasText: "Send" });
    await expect(sendBtn).toBeDisabled({ timeout: 5_000 });

    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeDisabled({ timeout: 5_000 });

    await expect(
      page.locator('[data-testid="env-disconnect-hint"]'),
    ).toBeVisible({ timeout: 5_000 });
  });
});
