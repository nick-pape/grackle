import { test as base, expect } from "./fixtures.js";
import { goToSettings } from "./helpers.js";

const test = base.extend<{ mockPage: import("@playwright/test").Page }>({
  mockPage: async ({ page }, use) => {
    await page.goto("/?mock");
    await page.waitForFunction(() => document.body.innerText.includes("Connected"), {
      timeout: 10_000,
    });
    await use(page);
  },
});

test.describe("Settings Tabs", { tag: ["@settings"] }, () => {
  test("default tab is Credentials", async ({ mockPage }) => {
    const page = mockPage;

    await goToSettings(mockPage);

    await expect(page).toHaveURL(/\/settings\/credentials/);
    await expect(page.getByRole("tab", { name: "Credentials" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("tab switching updates URL", async ({ mockPage }) => {
    const page = mockPage;

    await goToSettings(mockPage);

    // Personas was promoted to a top-level page (#1413); no longer in this rail.
    const tabs = ["GitHub Accounts", "Appearance", "About", "Credentials"];
    const paths = ["github-accounts", "appearance", "about", "credentials"];

    for (let i = 0; i < tabs.length; i++) {
      await page.getByRole("tab", { name: tabs[i] }).click();
      await expect(page).toHaveURL(new RegExp(`/settings/${paths[i]}`));
      await expect(page.getByRole("tab", { name: tabs[i] })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
  });

  test("deep link to /settings/credentials loads Credentials tab", async ({ mockPage }) => {
    const page = mockPage;

    await page.goto("/settings/credentials?mock");
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("tab", { name: "Credentials" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("heading", { name: "Credential Providers" })).toBeVisible();
  });

  test("back/forward works between tabs", async ({ mockPage }) => {
    const page = mockPage;

    await goToSettings(mockPage);
    await page.getByRole("tab", { name: "GitHub Accounts" }).click();
    await expect(page).toHaveURL(/\/settings\/github-accounts/);

    await page.getByRole("tab", { name: "About" }).click();
    await expect(page).toHaveURL(/\/settings\/about/);

    await page.goBack();
    await expect(page).toHaveURL(/\/settings\/github-accounts/);
    await expect(page.getByRole("tab", { name: "GitHub Accounts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.goForward();
    await expect(page).toHaveURL(/\/settings\/about/);
    await expect(page.getByRole("tab", { name: "About" })).toHaveAttribute("aria-selected", "true");
  });

  // Tests removed — covered by Storybook stories:
  // - "keyboard navigation" → SettingsNav.stories.tsx (KeyboardNavigation)
  // - "About tab shows connection info" → SettingsPage.stories.tsx (AboutTab)
  // - "persona button removed from StatusBar" → StatusBar.stories.tsx (NoPersonaButton)
  // - "breadcrumbs show Home > Settings" → SettingsPage.stories.tsx (BreadcrumbsVisible)
  // - "Appearance tab shows theme picker" → SettingsPage.stories.tsx (AppearanceTab)
  // - Persona library coverage moved to persona-library.spec.ts (#1413) + PersonaLibraryPage.stories.tsx
});
