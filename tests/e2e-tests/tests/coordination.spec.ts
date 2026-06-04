import { test, expect } from "./fixtures.js";

test.describe("Coordination tab", { tag: ["@session"] }, () => {
  test("nav shows Chat + Coordination, and Coordination opens the inventory", async ({
    appPage,
  }) => {
    const page = appPage;

    // Chat lives in the view bar; Coordination now lives at the fleet altitude
    // in the context rail (#1415), not the flat tab row.
    await expect(page.getByTestId("sidebar-tab-chat")).toBeVisible();
    const coordTab = page.getByTestId("context-nav").getByTestId("sidebar-tab-coordination");
    await expect(coordTab).toBeVisible();

    await coordTab.click();
    await expect(page).toHaveURL(/\/coordination/);
    await expect(page.getByTestId("coordination-page")).toBeVisible();
    await expect(page.getByTestId("coordination-list")).toBeVisible();

    // Internal IPC plumbing is hidden by default.
    const toggle = page.getByTestId("coordination-show-internals");
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
  });

  test("Sidebar list and main graph are both visible simultaneously", async ({ appPage }) => {
    const page = appPage;

    const coordTab = page.getByTestId("context-nav").getByTestId("sidebar-tab-coordination");
    await coordTab.click();
    await expect(page.getByTestId("coordination-page")).toBeVisible();

    // The stream list lives in the sidebar — always visible alongside the page.
    await expect(page.getByTestId("coordination-list")).toBeVisible();

    // The graph (or its empty state) is always in the main content area.
    await expect(
      page.getByTestId("coordination-graph").or(page.getByTestId("coordination-graph-empty")),
    ).toBeVisible();

    // Stream controls remain accessible in the sidebar list header.
    await expect(page.getByTestId("coordination-show-internals")).toBeVisible();
  });

  test("Chat has no stream inventory (that lives on Coordination)", async ({ appPage }) => {
    const page = appPage;

    await page.getByTestId("sidebar-tab-chat").click();
    await expect(page).toHaveURL(/\/chat/);
    await expect(page.getByTestId("chat-page")).toBeVisible();
    await expect(page.getByTestId("coordination-list")).toHaveCount(0);
  });

  test("legacy /chat/:streamId redirects to /coordination", async ({ appPage }) => {
    const page = appPage;

    await page.goto("/chat/some-stream-id");
    await expect(page).toHaveURL(/\/coordination/);
    await expect(page.getByTestId("coordination-page")).toBeVisible();
  });
});
