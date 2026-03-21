import { test, expect } from "./fixtures.js";

test.describe("Chat Page (root task)", () => {
  test("navigates to /chat by default and renders chat page", async ({ appPage }) => {
    const page = appPage;

    // The home route now renders the dashboard/welcome page.
    await expect(page).toHaveURL(/\/$/);

    await page.getByTestId("sidebar-tab-chat").click();
    await expect(page).toHaveURL(/\/chat/);

    // Chat page renders
    await expect(page.getByTestId("chat-page")).toBeVisible();
  });

  test("sidebar Chat tab is active on /chat", async ({ appPage }) => {
    const page = appPage;

    await page.getByTestId("sidebar-tab-chat").click();
    await expect(page).toHaveURL(/\/chat/);

    const chatTab = page.getByTestId("sidebar-tab-chat");
    await expect(chatTab).toBeVisible();
    await expect(chatTab).toHaveAttribute("aria-selected", "true");
  });

  test("sidebar Workspaces tab navigates away from chat", async ({ appPage }) => {
    const page = appPage;

    await page.getByTestId("sidebar-tab-chat").click();
    await expect(page).toHaveURL(/\/chat/);

    // Click Workspaces tab
    await page.getByTestId("sidebar-tab-workspaces").click();

    // Should navigate to /workspaces
    await expect(page).toHaveURL(/\/workspaces/);

    // Workspaces tab should now be active
    const workspacesTab = page.getByTestId("sidebar-tab-workspaces");
    await expect(workspacesTab).toHaveAttribute("aria-selected", "true");
  });

  test("chat input is present after root task auto-starts", async ({ appPage }) => {
    const page = appPage;

    await page.getByTestId("sidebar-tab-chat").click();
    await expect(page).toHaveURL(/\/chat/);

    // The root task auto-starts on server boot; wait for the session to go idle
    // and the chat input to appear.
    const input = page.locator('input[placeholder="Type a message..."]');
    await expect(input).toBeVisible({ timeout: 15_000 });
  });

  test("can send message to auto-started root task", async ({ appPage }) => {
    const page = appPage;

    await page.getByTestId("sidebar-tab-chat").click();
    await expect(page).toHaveURL(/\/chat/);

    // Wait for the root task session to be ready (auto-started on boot)
    const input = page.locator('input[placeholder="Type a message..."]');
    await expect(input).toBeVisible({ timeout: 15_000 });

    // Send a message via sendInput
    await input.fill("Hello system");
    await page.getByRole("button", { name: "Send" }).click();

    // The stub runtime echoes input; verify the message was delivered
    await expect(page.locator("text=Hello system")).toBeVisible({ timeout: 15_000 });
  });
});
