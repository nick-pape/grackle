import { test, expect } from "./fixtures.js";
import {
  sendWsMessage,
  installWsTracker,
  injectWsMessage,
} from "./helpers.js";

/**
 * Tests that environment status changes broadcast via WebSocket
 * update the StatusBar count and trigger toast notifications.
 *
 * Toast messages are generic (no resource names) to avoid strict-mode
 * violations with getByText() in other tests. See App.tsx comment.
 */

test.describe("Environment Status Broadcast + Toasts", { tag: ["@environment"] }, () => {
  test("stop environment shows disconnected toast and updates StatusBar", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected") && document.body.innerText.includes("env"),
      { timeout: 10_000 },
    );

    // Verify StatusBar initially shows connected count (1/1)
    await expect(page.getByText("1/1 env")).toBeVisible({ timeout: 5_000 });

    // Stop the environment via WS
    await sendWsMessage(page, {
      type: "stop_environment",
      payload: { environmentId: "test-local" },
    });

    // StatusBar should update to show 0 connected (0/1)
    await expect(page.getByText("0/1 env")).toBeVisible({ timeout: 10_000 });

    // A generic "disconnected" toast should appear
    await expect(page.getByText("Environment disconnected")).toBeVisible({ timeout: 5_000 });

    // Re-provision so other tests aren't affected
    await sendWsMessage(page, {
      type: "provision_environment",
      payload: { environmentId: "test-local" },
    });
    await expect(page.getByText("1/1 env")).toBeVisible({ timeout: 15_000 });
  });

  test("provision environment shows connected toast and updates StatusBar", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected") && document.body.innerText.includes("env"),
      { timeout: 10_000 },
    );

    // Stop the environment first
    await sendWsMessage(page, {
      type: "stop_environment",
      payload: { environmentId: "test-local" },
    });
    await expect(page.getByText("0/1 env")).toBeVisible({ timeout: 10_000 });

    // Now re-provision
    await sendWsMessage(page, {
      type: "provision_environment",
      payload: { environmentId: "test-local" },
    });

    // StatusBar should show 1/1 again
    await expect(page.getByText("1/1 env")).toBeVisible({ timeout: 15_000 });

    // A generic "connected" toast should appear
    await expect(page.getByText("Environment connected")).toBeVisible({ timeout: 5_000 });
  });

  test("injected environment removal shows removal toast", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected") && document.body.innerText.includes("env"),
      { timeout: 10_000 },
    );

    // Inject a two-environment list first
    await injectWsMessage(page, {
      type: "environments",
      payload: {
        environments: [
          {
            id: "test-local",
            displayName: "test-local",
            adapterType: "local",

            status: "connected",
            bootstrapped: true,
          },
          {
            id: "temp-env",
            displayName: "Temp Env",
            adapterType: "local",

            status: "connected",
            bootstrapped: false,
          },
        ],
      },
    });

    // Verify both appear in StatusBar count
    await expect(page.getByText("2/2 envs")).toBeVisible({ timeout: 5_000 });

    // Now inject list without temp-env (simulate removal)
    await injectWsMessage(page, {
      type: "environments",
      payload: {
        environments: [
          {
            id: "test-local",
            displayName: "test-local",
            adapterType: "local",

            status: "connected",
            bootstrapped: true,
          },
        ],
      },
    });

    // Generic removal toast should appear
    await expect(page.getByText("Environment removed")).toBeVisible({ timeout: 5_000 });

    // StatusBar should now show 1/1
    await expect(page.getByText("1/1 env")).toBeVisible({ timeout: 5_000 });
  });

  // TODO(#786): Removed — this test injected fake WS "environments" data with
  // status "error" which the ConnectRPC-migrated hooks no longer handle.
  // Rewrite needed: test provision error path via ProvisionEnvironment RPC.
});
