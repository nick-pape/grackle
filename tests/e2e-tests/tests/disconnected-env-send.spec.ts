/**
 * Tests for #400: Block message send when task environment is disconnected.
 *
 * When a task is in `idle` state but its assigned environment is
 * disconnected, the Send button should be disabled and a Reconnect button
 * should appear inline so the user can re-establish the connection without
 * navigating away from the stream view.
 *
 * Strategy: start a real task via the stub runtime, wait for it to go idle,
 * then stop the environment via gRPC to trigger a genuine disconnected state.
 * All state transitions flow through the ConnectRPC StreamEvents transport.
 */
import { test, expect } from "./fixtures.js";
import type { StubTaskContext } from "./fixtures.js";
import {
  stubScenario,
  emitText,
  idle,
  provisionEnvironmentDirect,
  patchWsForStubRuntime,
} from "./helpers.js";

test.describe("Disconnected environment blocks message send", { tag: ["@error"] }, () => {
  /**
   * Start a stub task to idle state, then stop the environment to simulate
   * a connectivity drop. Returns after the reconnect button is visible.
   */
  async function startTaskAndDisconnectEnv(
    stubTask: StubTaskContext,
    taskTitle: string,
  ): Promise<void> {
    const { page, client } = stubTask;
    await stubTask.createAndNavigate(taskTitle, stubScenario(emitText("hello"), idle()));
    await page.getByTestId("task-header-start").click();

    // Wait for idle — input field appears
    await page.locator('input[placeholder="Type a message..."]').waitFor({ timeout: 15_000 });

    // Stop the environment via RPC — triggers domain event
    await client.core.stopEnvironment({ id: "test-local" });

    // Wait for reconnect button — confirms the UI processed the disconnect
    await page
      .locator('[data-testid="reconnect-btn"]')
      .waitFor({ state: "visible", timeout: 10_000 });
  }

  test("Send button and input are disabled when task environment is disconnected", async ({ stubTask }) => {
    await startTaskAndDisconnectEnv(stubTask, "disc-task-1");
    const { page } = stubTask;

    const sendBtn = page.locator("button", { hasText: "Send" });
    await expect(sendBtn).toBeDisabled({ timeout: 5_000 });

    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeDisabled({ timeout: 5_000 });
  });

  test("Send button wrapper has explanatory title when environment is disconnected", async ({ stubTask }) => {
    await startTaskAndDisconnectEnv(stubTask, "disc-task-2");
    const { page } = stubTask;

    // The disabled Send button is wrapped in a <span title="...">
    const sendBtn = page.locator("button", { hasText: "Send" });
    const sendBtnWrapper = sendBtn.locator("xpath=..");
    await expect(sendBtnWrapper).toHaveAttribute(
      "title",
      /unavailable/i,
      { timeout: 5_000 },
    );
  });

  test("disconnect hint text is visible when environment is disconnected", async ({ stubTask }) => {
    await startTaskAndDisconnectEnv(stubTask, "disc-task-3");
    const { page } = stubTask;

    await expect(
      page.locator('[data-testid="env-disconnect-hint"]'),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator('[data-testid="env-disconnect-hint"]'),
    ).toContainText(/unavailable/i);
  });

  test("Reconnect button is visible when environment is disconnected", async ({ stubTask }) => {
    await startTaskAndDisconnectEnv(stubTask, "disc-task-4");
    const { page } = stubTask;

    const reconnectBtn = page.locator('[data-testid="reconnect-btn"]');
    await expect(reconnectBtn).toBeVisible({ timeout: 5_000 });
    await expect(reconnectBtn).toContainText("Reconnect");
  });

  test("clicking Reconnect button sends provision_environment to server", async ({ stubTask }) => {
    await startTaskAndDisconnectEnv(stubTask, "disc-task-5");
    const { page } = stubTask;

    // Intercept outgoing fetch calls to capture ProvisionEnvironment RPC.
    await page.evaluate(() => {
      const origFetch = window.fetch;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__provisionCaptured__ = { value: false };
      window.fetch = function (...args: Parameters<typeof fetch>) {
        const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
        if (url.includes("ProvisionEnvironment")) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__provisionCaptured__.value = true;
        }
        return origFetch.apply(this, args);
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

  test("Send button re-enables when environment reconnects", async ({ stubTask }) => {
    await startTaskAndDisconnectEnv(stubTask, "disc-task-6");
    const { page } = stubTask;

    // Confirm Send is currently disabled
    const sendBtn = page.locator("button", { hasText: "Send" });
    await expect(sendBtn).toBeDisabled({ timeout: 5_000 });

    // Re-provision the environment (simulates reconnection)
    await provisionEnvironmentDirect("test-local", stubTask.client);

    // Input should be re-enabled — fill it so Send can be checked
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeEnabled({ timeout: 10_000 });
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

  test("Send button is disabled in session mode when environment is disconnected", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Apply stub runtime fetch patch for the session spawn
    await patchWsForStubRuntime(page);

    // Spawn a session via the environment detail page
    await page.locator('[data-testid="sidebar-tab-environments"]').click();
    await page.getByTestId("env-nav-item").first().click();
    await page.getByRole("button", { name: "New Chat" }).click();

    const promptInput = page.locator('input[placeholder="Enter prompt..."]');
    await promptInput.fill("hello stub");
    await page.locator("button", { hasText: "Go" }).click();

    // Wait for the session to reach idle state
    await page
      .locator('input[placeholder="Type a message..."]')
      .waitFor({ state: "visible", timeout: 15_000 });

    // Stop the environment to simulate a connectivity drop
    await client.core.stopEnvironment({ id: "test-local" });

    // Reconnect button must appear, confirming the disconnect was processed
    await page
      .locator('[data-testid="reconnect-btn"]')
      .waitFor({ state: "visible", timeout: 10_000 });

    const sendBtn = page.locator("button", { hasText: "Send" });
    await expect(sendBtn).toBeDisabled({ timeout: 5_000 });

    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeDisabled({ timeout: 5_000 });

    await expect(
      page.locator('[data-testid="env-disconnect-hint"]'),
    ).toBeVisible({ timeout: 5_000 });
  });
});
