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
    const sidebar = appPage.getByTestId("sidebar");

    // Navigate to settings programmatically (sidebar tab click has z-index issues on mobile)
    await appPage.goto("/settings/credentials");
    await appPage.waitForFunction(() => document.body.innerText.includes("Connected"), { timeout: 10_000 });

    // Open the drawer
    const hamburger = appPage.getByRole("button", { name: "Toggle sidebar" });
    await hamburger.click();
    await expect(sidebar).toBeVisible();

    // Navigate away (clicking Grackle brand)
    await appPage.locator('button[title="Home"]').click();

    // Sidebar drawer should auto-close after navigation
    await expect(sidebar).not.toBeVisible({ timeout: 5_000 });
  });

  test("hamburger is visible on all pages including settings", async ({ appPage }) => {
    const hamburger = appPage.getByRole("button", { name: "Toggle sidebar" });

    // Hamburger should be visible on the default page
    await expect(hamburger).toBeVisible();

    // Navigate to settings programmatically
    await appPage.goto("/settings/credentials");
    await appPage.waitForFunction(() => document.body.innerText.includes("Connected"), { timeout: 10_000 });

    // Hamburger should still be visible on settings pages
    await expect(hamburger).toBeVisible();
  });

  test("settings tabs visible when drawer is opened on settings page", async ({ appPage }) => {
    const hamburger = appPage.getByRole("button", { name: "Toggle sidebar" });
    const sidebar = appPage.getByTestId("sidebar");

    // Navigate to settings programmatically
    await appPage.goto("/settings/credentials");
    await appPage.waitForFunction(() => document.body.innerText.includes("Connected"), { timeout: 10_000 });

    // Open the drawer
    await hamburger.click();
    await expect(sidebar).toBeVisible();

    // Settings tabs should be visible inside the sidebar
    await expect(appPage.getByRole("tab", { name: "Credentials" })).toBeVisible({ timeout: 5_000 });
    await expect(appPage.getByRole("tab", { name: "Appearance" })).toBeVisible();
  });
});
