import { test, expect } from "./fixtures.js";

/** Mobile viewport dimensions (iPhone SE). */
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

    // Click the overlay (outside the sidebar)
    const overlay = appPage.locator('[class*="overlay"]');
    await overlay.click({ position: { x: 350, y: 400 } });
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
    // First navigate to settings so we have a non-root path
    await appPage.locator('button[title="Settings"]').click();
    await appPage.getByRole("tablist", { name: "Settings" }).waitFor({ state: "visible", timeout: 5_000 });

    // Go back home — on settings page there's no hamburger,
    // so navigate home first, then open the drawer
    await appPage.getByRole("button", { name: "Grackle" }).click();
    await appPage.waitForURL("**/");

    const hamburger = appPage.getByRole("button", { name: "Toggle sidebar" });
    const sidebar = appPage.getByTestId("sidebar");

    // Open drawer
    await hamburger.click();
    await expect(sidebar).toBeVisible();

    // Navigate to settings via the gear — the button is in the StatusBar (above the overlay)
    await appPage.locator('button[title="Settings"]').click();
    await expect(sidebar).not.toBeVisible({ timeout: 5_000 });
  });

  test("hamburger is not shown on settings pages", async ({ appPage }) => {
    await appPage.locator('button[title="Settings"]').click();
    await appPage.getByRole("tablist", { name: "Settings" }).waitFor({ state: "visible", timeout: 5_000 });

    const hamburger = appPage.getByRole("button", { name: "Toggle sidebar" });
    await expect(hamburger).toHaveCount(0);
  });

  test("settings tabs render horizontally on mobile", async ({ appPage }) => {
    await appPage.locator('button[title="Settings"]').click();
    const tablist = appPage.getByRole("tablist", { name: "Settings" });
    await expect(tablist).toBeVisible();

    // All tabs should be visible
    await expect(appPage.getByRole("tab", { name: "Environments" })).toBeVisible();
    await expect(appPage.getByRole("tab", { name: "Appearance" })).toBeVisible();
  });
});
