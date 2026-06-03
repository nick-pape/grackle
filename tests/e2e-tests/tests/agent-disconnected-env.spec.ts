/**
 * Tests for #1507: AgentChatTab renders ChatInput for suspended sessions.
 *
 * When an agent's session is suspended (via environment stop), the Agent
 * chat tab must keep ChatInput in "send" mode so the disconnected-env
 * hint and Reconnect button remain reachable.
 *
 * Strategy: create an agent, start its root task with the stub runtime
 * (goes idle automatically), navigate to the agent chat tab, stop the
 * environment (suspends the session), and assert the reconnect UI appears.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures.js";
import type { GrackleClient } from "./rpc-client.js";
import { provisionEnvironmentDirect } from "./helpers.js";

const POLL_INTERVAL_MS = 250;

/** Generate a unique agent name to avoid cross-test collisions. */
function uniqueAgentName(prefix: string): string {
  return `${prefix}-${Math.floor(Date.now() / 1000)}-${Math.floor(Math.random() * 10000)}`;
}

/** Poll until the agent's root task exists and return its ID. */
async function waitForRootTask(
  client: GrackleClient,
  agentId: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await client.orchestration.listTasks({});
    const root = resp.tasks.find(
      (t: { agentId: string; kind: string }) => t.agentId === agentId && t.kind === "root",
    );
    if (root) {
      return root.id as string;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for root task of agent ${agentId}`);
}

/** Poll until the task has at least one session in "idle" status. */
async function waitForIdleSession(
  client: GrackleClient,
  taskId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await client.core.getTaskSessions({ id: taskId });
    if (resp.sessions.some((s: { status: string }) => s.status === "idle")) {
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for idle session on task ${taskId}`);
}

test.describe(
  "Agent chat tab — disconnected environment (#1507)",
  { tag: ["@agent", "@error"] },
  () => {
    /**
     * Create an agent, start its root task with the stub runtime, wait for
     * idle, navigate to the agent chat tab, and stop the environment.
     * Returns after the reconnect button is visible.
     */
    async function setupDisconnectedAgent(
      page: Page,
      client: GrackleClient,
    ): Promise<{ agentId: string }> {
      const agentName = uniqueAgentName("AgentDisc");
      const agent = await client.orchestration.createAgent({
        name: agentName,
        environmentId: "test-local",
        primaryPersonaId: "stub",
      });

      const rootTaskId = await waitForRootTask(client, agent.id, 5_000);

      await client.orchestration.startTask({
        taskId: rootTaskId,
        personaId: "stub",
        environmentId: "test-local",
      });

      await waitForIdleSession(client, rootTaskId, 15_000);

      const contextItem = page.locator(`[data-testid="context-agent-${agent.id}"]`);
      await contextItem.waitFor({ state: "visible", timeout: 10_000 });
      await contextItem.click();

      await expect(page.locator('[data-testid="agent-chat-tab"]')).toBeVisible({ timeout: 5_000 });

      await page
        .locator('textarea[placeholder="Type a message..."]')
        .waitFor({ state: "visible", timeout: 10_000 });

      await client.core.stopEnvironment({ id: "test-local" });

      await page
        .locator('[data-testid="reconnect-btn"]')
        .waitFor({ state: "visible", timeout: 10_000 });

      return { agentId: agent.id };
    }

    test("Reconnect button is visible when agent session is suspended", async ({
      appPage,
      grackle: { client },
    }) => {
      test.setTimeout(60_000);
      await setupDisconnectedAgent(appPage, client);

      const reconnectBtn = appPage.locator('[data-testid="reconnect-btn"]');
      await expect(reconnectBtn).toBeVisible({ timeout: 5_000 });
      await expect(reconnectBtn).toContainText("Reconnect");
    });

    test("Send button and input are disabled when agent session is suspended", async ({
      appPage,
      grackle: { client },
    }) => {
      test.setTimeout(60_000);
      await setupDisconnectedAgent(appPage, client);

      const sendBtn = appPage.locator("button", { hasText: "Send" });
      await expect(sendBtn).toBeDisabled({ timeout: 5_000 });

      const inputField = appPage.locator('textarea[placeholder="Type a message..."]');
      await expect(inputField).toBeDisabled({ timeout: 5_000 });
    });

    test("disconnect hint is visible when agent session is suspended", async ({
      appPage,
      grackle: { client },
    }) => {
      test.setTimeout(60_000);
      await setupDisconnectedAgent(appPage, client);

      await expect(appPage.locator('[data-testid="env-disconnect-hint"]')).toBeVisible({
        timeout: 5_000,
      });
      await expect(appPage.locator('[data-testid="env-disconnect-hint"]')).toContainText(
        /unavailable/i,
      );
    });

    test("Send button re-enables when environment reconnects", async ({
      appPage,
      grackle: { client },
    }) => {
      test.setTimeout(60_000);
      await setupDisconnectedAgent(appPage, client);

      const sendBtn = appPage.locator("button", { hasText: "Send" });
      await expect(sendBtn).toBeDisabled({ timeout: 5_000 });

      await provisionEnvironmentDirect("test-local", client);

      const inputField = appPage.locator('textarea[placeholder="Type a message..."]');
      await expect(inputField).toBeEnabled({ timeout: 10_000 });
      await inputField.fill("hello");

      await expect(sendBtn).toBeEnabled({ timeout: 5_000 });

      await expect(appPage.locator('[data-testid="reconnect-btn"]')).not.toBeVisible({
        timeout: 5_000,
      });
      await expect(appPage.locator('[data-testid="env-disconnect-hint"]')).not.toBeVisible({
        timeout: 5_000,
      });
    });
  },
);
