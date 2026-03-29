import { test, expect } from "./fixtures.js";
import { provisionEnvironmentDirect } from "./helpers.js";

/**
 * Tests that environment status changes broadcast via ConnectRPC StreamEvents
 * update the StatusBar count and trigger toast notifications.
 *
 * Toast messages are generic (no resource names) to avoid strict-mode
 * violations with getByText() in other tests. See App.tsx comment.
 */

test.describe("Environment Status Broadcast + Toasts", { tag: ["@environment"] }, () => {
  test("stop environment shows disconnected toast and updates StatusBar", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Ensure connected before starting (may have been left disconnected)
    await provisionEnvironmentDirect("test-local", client);

    // Wait for fully connected state
    await expect(page.getByText("1/1 env")).toBeVisible({ timeout: 15_000 });

    // Stop the environment via RPC
    await client.stopEnvironment({ id: "test-local" });

    // StatusBar should update to show 0 connected (0/1)
    await expect(page.getByText("0/1 env")).toBeVisible({ timeout: 10_000 });

    // A generic "disconnected" toast should appear
    await expect(page.getByText("Environment disconnected")).toBeVisible({ timeout: 5_000 });

    // Re-provision so other tests aren't affected
    await provisionEnvironmentDirect("test-local", client);
    await expect(page.getByText("1/1 env")).toBeVisible({ timeout: 15_000 });
  });

  test("provision environment shows connected toast and updates StatusBar", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Stop the environment first
    await client.stopEnvironment({ id: "test-local" });
    await expect(page.getByText("0/1 env")).toBeVisible({ timeout: 10_000 });

    // Re-provision via direct gRPC call
    await provisionEnvironmentDirect("test-local", client);

    // StatusBar should show 1/1 again
    await expect(page.getByText("1/1 env")).toBeVisible({ timeout: 15_000 });

    // A generic "connected" toast should appear
    await expect(page.getByText("Environment connected")).toBeVisible({ timeout: 5_000 });
  });

  test("environment removal shows removal toast", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Add a real temporary environment
    const added = await client.addEnvironment({
      displayName: "Temp Env",
      adapterType: "local",
    });

    // Wait for the new environment to appear (total count increases to 2).
    // The new env starts disconnected, so the count may be "1/2 envs" (not "2/2").
    await expect(page.getByText(/\/2 envs/)).toBeVisible({ timeout: 10_000 });

    // Remove the temporary environment via RPC
    await client.removeEnvironment({ id: added.id });

    // Generic removal toast should appear
    await expect(page.getByText("Environment removed")).toBeVisible({ timeout: 5_000 });

    // StatusBar should now show 1/1
    await expect(page.getByText("1/1 env")).toBeVisible({ timeout: 5_000 });
  });
});
