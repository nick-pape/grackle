import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures.js";

/** Mobile viewport dimensions (iPhone X / 11 Pro). */
const MOBILE_VIEWPORT = { width: 375, height: 812 };

/** Wait until the app shell has connected and rendered. */
async function waitForConnected(page: Page): Promise<void> {
  await page.waitForFunction(() => document.body.innerText.includes("Connected"), {
    timeout: 10_000,
  });
}

test.describe("Context nav (context axis)", { tag: ["@webui", "@smoke"] }, () => {
  test("Code rail renders with the workbench views and global cluster", async ({ appPage }) => {
    const page = appPage;
    await page.goto("/chat");
    await waitForConnected(page);

    // Context axis: the Code rail is the outermost-left navigation.
    await expect(page.getByTestId("context-nav")).toBeVisible();
    await expect(page.getByTestId("context-code")).toBeVisible();

    // View axis: workbench views live in the tab bar.
    await expect(page.getByTestId("sidebar-tab-chat")).toBeVisible();
    await expect(page.getByTestId("sidebar-tab-sessions")).toBeVisible();

    // Settings is end-aligned in the Code tab bar.
    await expect(page.getByTestId("sidebar-tab-settings")).toBeVisible();
    // Environments is a fleet surface in the context rail.
    await expect(
      page.getByTestId("context-nav").getByTestId("sidebar-tab-environments"),
    ).toBeVisible();
  });

  test("Coordination lives at the fleet altitude (context rail), not the view bar", async ({
    appPage,
  }) => {
    const page = appPage;
    await page.goto("/");
    await waitForConnected(page);

    // Fleet altitude (#1415): Coordination is in the context rail...
    await expect(
      page.getByTestId("context-nav").getByTestId("sidebar-tab-coordination"),
    ).toBeVisible();
    // ...and NOT in the horizontal view bar.
    await expect(
      page.getByTestId("sidebar-nav").getByTestId("sidebar-tab-coordination"),
    ).toHaveCount(0);

    // Selecting it from the rail navigates to the Coordination page.
    await page.getByTestId("context-nav").getByTestId("sidebar-tab-coordination").click();
    await expect(page).toHaveURL(/\/coordination/);
    await expect(page.getByTestId("coordination-page")).toBeVisible();
  });

  test("Coordination stays reachable when the rail is collapsed", async ({ appPage }) => {
    const page = appPage;
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("context-nav-toggle").click();
    await expect(page.getByTestId("context-nav")).toHaveAttribute("data-collapsed", "true");

    // Icon-only, but still present and navigable.
    await page.getByTestId("context-nav").getByTestId("sidebar-tab-coordination").click();
    await expect(page).toHaveURL(/\/coordination/);
    await expect(page.getByTestId("coordination-page")).toBeVisible();
  });

  test("workbench views remain reachable through the view tabs", async ({ appPage }) => {
    const page = appPage;
    await page.goto("/chat");
    await waitForConnected(page);

    // Chat is the default Code context view, always present.
    await expect(page.getByTestId("sidebar-tab-chat")).toBeVisible();
    await expect(page).toHaveURL(/\/chat$/);

    // Sessions is a workbench view in the Code tab bar.
    await page.getByTestId("sidebar-tab-sessions").click();
    await expect(page).toHaveURL(/\/sessions/);
  });

  test("collapse toggle hides the Code label on desktop", async ({ appPage }) => {
    const page = appPage;
    await page.goto("/");
    await waitForConnected(page);

    const rail = page.getByTestId("context-nav");
    const toggle = page.getByTestId("context-nav-toggle");

    await expect(rail).toHaveAttribute("data-collapsed", "false");
    await expect(page.getByTestId("context-code")).toHaveText(/Code/);

    await toggle.click();
    await expect(rail).toHaveAttribute("data-collapsed", "true");
    // Collapsed: the label is no longer rendered inline.
    await expect(page.getByTestId("context-code")).not.toHaveText(/Code/);

    await toggle.click();
    await expect(rail).toHaveAttribute("data-collapsed", "false");
  });

  test("Code tab bar is hidden on fleet pages", async ({ appPage }) => {
    const page = appPage;
    await page.goto("/chat");
    await waitForConnected(page);

    // Tab bar is visible on Code (workbench) pages.
    await expect(page.getByTestId("sidebar-nav")).toBeVisible();

    // Navigate to a fleet page — the tab bar should disappear.
    await page.getByTestId("context-nav").getByTestId("sidebar-tab-coordination").click();
    await expect(page).toHaveURL(/\/coordination/);
    await expect(page.getByTestId("sidebar-nav")).toHaveCount(0);
  });

  test("clicking Code from a fleet page navigates to the Code context", async ({ appPage }) => {
    const page = appPage;
    await page.goto("/coordination");
    await waitForConnected(page);

    await expect(page.getByTestId("coordination-page")).toBeVisible();

    // Clicking the Code context should navigate to /chat (first Code tab).
    await page.getByTestId("context-code").click();
    await expect(page).toHaveURL(/\/chat/);
    await expect(page.getByTestId("sidebar-nav")).toBeVisible();
  });
});

test.describe("Context nav drawer (mobile)", { tag: ["@webui"] }, () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("context rail is hidden by default and toggles open", async ({ appPage }) => {
    const page = appPage;
    await page.goto("/");
    await waitForConnected(page);

    const rail = page.getByTestId("context-nav");
    await expect(rail).not.toBeVisible();

    const toggle = page.getByRole("button", { name: "Toggle contexts" });
    await toggle.click();
    await expect(rail).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // visibility: hidden has a transition delay on close.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(rail).not.toBeVisible({ timeout: 5_000 });
  });

  test("drawer content sits below the StatusBar (top rows not clipped)", async ({ appPage }) => {
    const page = appPage;
    await page.goto("/");
    await waitForConnected(page);

    const toggle = page.getByRole("button", { name: "Toggle contexts" });
    await toggle.click();
    const rail = page.getByTestId("context-nav");
    await expect(rail).toBeVisible();

    // Regression guard for #1425: the drawer is anchored to the content area
    // below the StatusBar (not the viewport top), so its topmost rows
    // (Fleet/Coordination) are not clipped behind the higher-z-index StatusBar.
    await expect(rail.getByTestId("sidebar-tab-coordination")).toBeVisible();
    const toggleBox = await toggle.boundingBox();
    const railBox = await rail.boundingBox();
    expect(toggleBox).not.toBeNull();
    expect(railBox).not.toBeNull();
    // The rail starts at or below the bottom edge of the StatusBar's controls.
    expect(railBox!.y).toBeGreaterThanOrEqual(toggleBox!.y + toggleBox!.height - 1);
  });

  test("Escape closes the context drawer", async ({ appPage }) => {
    const page = appPage;
    await page.goto("/");
    await waitForConnected(page);

    const rail = page.getByTestId("context-nav");
    await page.getByRole("button", { name: "Toggle contexts" }).click();
    await expect(rail).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(rail).not.toBeVisible({ timeout: 5_000 });
  });

  test("selecting Coordination from the drawer navigates and closes it", async ({ appPage }) => {
    const page = appPage;
    await page.goto("/");
    await waitForConnected(page);

    const rail = page.getByTestId("context-nav");
    await page.getByRole("button", { name: "Toggle contexts" }).click();
    await expect(rail).toBeVisible();

    await rail.getByTestId("sidebar-tab-coordination").click();
    await expect(page).toHaveURL(/\/coordination/);
    await expect(page.getByTestId("coordination-page")).toBeVisible();
    // Navigation dismisses the drawer.
    await expect(rail).not.toBeVisible({ timeout: 5_000 });
  });
});
