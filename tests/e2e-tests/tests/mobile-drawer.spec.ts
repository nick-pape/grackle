import { test, expect } from "./fixtures.js";

/** Mobile viewport dimensions (iPhone X / 11 Pro). */
const MOBILE_VIEWPORT = { width: 375, height: 812 };

test.describe("Mobile Drawer", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("hamburger button is visible on mobile", async ({ appPage }) => {
    const hamburger = appPage.getByRole("button", { name: "Toggle sidebar" });
    await expect(hamburger).toBeVisible();
  });

  test("sidebar is hidden by default on mobile", async ({ appPage }) => {
    const sidebar = appPage.getByTestId("sidebar");
    await expect(sidebar).not.toBeVisible();
  });

  test("hamburger opens and closes the sidebar drawer", async ({ appPage }) => {
    const hamburger = appPage.getByRole("button", { name: "Toggle sidebar" });
    const sidebar = appPage.getByTestId("sidebar");

    // Open drawer
    await hamburger.click();
    await expect(sidebar).toBeVisible();
    await expect(hamburger).toHaveAttribute("aria-expanded", "true");

    // Close drawer — visibility: hidden has a 400ms transition delay
    await hamburger.click();
    await expect(hamburger).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar).not.toBeVisible({ timeout: 5_000 });
  });

  test("overlay click closes the drawer", async ({ appPage }) => {
    const hamburger = appPage.getByRole("button", { name: "Toggle sidebar" });
    const sidebar = appPage.getByTestId("sidebar");

    await hamburger.click();
    await expect(sidebar).toBeVisible();

    // Click outside the drawer (right side of screen) to dismiss via overlay
    await appPage.mouse.click(350, 400);
    await expect(sidebar).not.toBeVisible();
  });

  test("Escape key closes the drawer", async ({ appPage }) => {
    const hamburger = appPage.getByRole("button", { name: "Toggle sidebar" });
    const sidebar = appPage.getByTestId("sidebar");

    await hamburger.click();
    await expect(sidebar).toBeVisible();

    await appPage.keyboard.press("Escape");
    await expect(sidebar).not.toBeVisible();
  });

  test("navigation auto-closes the drawer", async ({ appPage }) => {
    const hamburger = appPage.getByRole("button", { name: "Toggle sidebar" });
    const sidebar = appPage.getByTestId("sidebar");

    // Open drawer
    await hamburger.click();
    await expect(sidebar).toBeVisible();

    // Navigate to settings via the sidebar tab — this triggers a navigation
    await appPage.locator('[data-testid="sidebar-tab-settings"]').click();
    await expect(sidebar).not.toBeVisible({ timeout: 5_000 });
  });

  test("hamburger is always shown (including on settings pages)", async ({ appPage }) => {
    // Navigate to settings via sidebar tab
    const hamburger = appPage.getByRole("button", { name: "Toggle sidebar" });

    // Open drawer to access settings tab
    await hamburger.click();
    await appPage.locator('[data-testid="sidebar-tab-settings"]').click();
    await appPage.getByRole("tablist", { name: "Settings" }).waitFor({ state: "visible", timeout: 5_000 });

    // Hamburger should still be visible on settings pages
    await expect(hamburger).toBeVisible();
  });

  test("settings tabs render inside sidebar on mobile", async ({ appPage }) => {
    const hamburger = appPage.getByRole("button", { name: "Toggle sidebar" });

    // Open drawer and switch to settings
    await hamburger.click();
    await appPage.locator('[data-testid="sidebar-tab-settings"]').click();

    // Settings nav should be rendered inside the sidebar
    const tablist = appPage.getByRole("tablist", { name: "Settings" });
    await expect(tablist).toBeVisible();

    // Settings tabs should be visible
    await expect(appPage.getByRole("tab", { name: "Environments" })).toBeVisible();
    await expect(appPage.getByRole("tab", { name: "Appearance" })).toBeVisible();
  });
});
