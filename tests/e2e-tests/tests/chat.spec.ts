import { test, expect } from "./fixtures.js";
import { patchWsForStubRuntime } from "./helpers.js";

test.describe("Chat Page (root task)", () => {
  test("navigates to /chat by default and renders chat page", async ({ appPage }) => {
    const page = appPage;

    // The index route redirects to /chat
    await expect(page).toHaveURL(/\/chat/);

    // Chat page renders
    await expect(page.getByTestId("chat-page")).toBeVisible();

    // Empty state is shown
    await expect(page.getByTestId("chat-empty-state")).toBeVisible();
  });

  test("sidebar Chat tab is active on /chat", async ({ appPage }) => {
    const page = appPage;

    await expect(page).toHaveURL(/\/chat/);

    const chatTab = page.getByTestId("sidebar-tab-chat");
    await expect(chatTab).toBeVisible();
    await expect(chatTab).toHaveAttribute("data-active", "true");
  });

  test("sidebar Workspaces tab navigates away from chat", async ({ appPage }) => {
    const page = appPage;

    await expect(page).toHaveURL(/\/chat/);

    // Click Workspaces tab
    await page.getByTestId("sidebar-tab-workspaces").click();

    // Should navigate to /workspaces
    await expect(page).toHaveURL(/\/workspaces/);

    // Workspaces tab should now be active
    const workspacesTab = page.getByTestId("sidebar-tab-workspaces");
    await expect(workspacesTab).toHaveAttribute("data-active", "true");
  });

  test("chat input is present with local env", async ({ appPage }) => {
    const page = appPage;

    await expect(page).toHaveURL(/\/chat/);

    // The UnifiedBar should show an input (since test harness has a local env)
    const input = page.locator('input[placeholder="Type a message..."]');
    await expect(input).toBeVisible({ timeout: 5_000 });
  });

  test("can start root task via chat input", async ({ appPage }) => {
    const page = appPage;

    await expect(page).toHaveURL(/\/chat/);

    // Patch WS to force stub runtime
    await patchWsForStubRuntime(page);

    // Type a message and submit
    const input = page.locator('input[placeholder="Type a message..."]');
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.fill("Hello system");
    await page.getByRole("button", { name: "Send" }).click();

    // Events should start appearing from the stub runtime
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 15_000 });
  });
});
