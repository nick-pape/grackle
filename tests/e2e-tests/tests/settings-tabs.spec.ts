import { test as base, expect } from "./fixtures.js";
import { goToSettings } from "./helpers.js";

const test = base.extend<{ mockPage: import("@playwright/test").Page }>({
  mockPage: async ({ page }, use) => {
    await page.goto("/?mock");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );
    await use(page);
  },
});

test.describe("Settings Tabs", () => {
  test("default tab is Environments", async ({ mockPage }) => {
    const page = mockPage;

    await goToSettings(mockPage);

    await expect(page).toHaveURL(/\/settings\/environments/);
    await expect(page.getByRole("tab", { name: "Environments" })).toHaveAttribute("aria-selected", "true");
  });

  test("tab switching updates URL", async ({ mockPage }) => {
    const page = mockPage;

    await goToSettings(mockPage);

    const tabs = ["Credentials", "Personas", "Appearance", "About", "Environments"];
    const paths = ["credentials", "personas", "appearance", "about", "environments"];

    for (let i = 0; i < tabs.length; i++) {
      await page.getByRole("tab", { name: tabs[i] }).click();
      await expect(page).toHaveURL(new RegExp(`/settings/${paths[i]}`));
      await expect(page.getByRole("tab", { name: tabs[i] })).toHaveAttribute("aria-selected", "true");
    }
  });

  test("deep link to /settings/credentials loads Credentials tab", async ({ mockPage }) => {
    const page = mockPage;

    await page.goto("/settings/credentials?mock");
    await expect(page.getByRole("tablist")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("tab", { name: "Credentials" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Credential Providers" })).toBeVisible();
  });



  test("back/forward works between tabs", async ({ mockPage }) => {
    const page = mockPage;

    await goToSettings(mockPage);
    await page.getByRole("tab", { name: "Credentials" }).click();
    await expect(page).toHaveURL(/\/settings\/credentials/);

    await page.getByRole("tab", { name: "About" }).click();
    await expect(page).toHaveURL(/\/settings\/about/);

    await page.goBack();
    await expect(page).toHaveURL(/\/settings\/credentials/);
    await expect(page.getByRole("tab", { name: "Credentials" })).toHaveAttribute("aria-selected", "true");

    await page.goForward();
    await expect(page).toHaveURL(/\/settings\/about/);
    await expect(page.getByRole("tab", { name: "About" })).toHaveAttribute("aria-selected", "true");
  });

  test("keyboard navigation with arrow keys", async ({ mockPage }) => {
    const page = mockPage;

    await goToSettings(mockPage);

    // Focus the active tab
    const envTab = page.getByRole("tab", { name: "Environments" });
    await envTab.focus();

    // Arrow down should move to Credentials
    await page.keyboard.press("ArrowDown");
    await expect(page).toHaveURL(/\/settings\/credentials/);
    await expect(page.getByRole("tab", { name: "Credentials" })).toBeFocused();

    // Arrow down again -> Personas
    await page.keyboard.press("ArrowDown");
    await expect(page).toHaveURL(/\/settings\/personas/);
    await expect(page.getByRole("tab", { name: "Personas" })).toBeFocused();

    // Home -> Environments
    await page.keyboard.press("Home");
    await expect(page).toHaveURL(/\/settings\/environments/);
    await expect(page.getByRole("tab", { name: "Environments" })).toBeFocused();

    // End -> About
    await page.keyboard.press("End");
    await expect(page).toHaveURL(/\/settings\/about/);
    await expect(page.getByRole("tab", { name: "About" })).toBeFocused();

    // Arrow up -> Appearance
    await page.keyboard.press("ArrowUp");
    await expect(page).toHaveURL(/\/settings\/appearance/);
  });

  test("Personas tab shows PersonaManager", async ({ mockPage }) => {
    const page = mockPage;

    await goToSettings(mockPage);
    await page.getByRole("tab", { name: "Personas" }).click();

    await expect(page.getByRole("heading", { name: "Personas" })).toBeVisible();
    await expect(page.getByText("+ New Persona")).toBeVisible();
  });

  test("About tab shows connection info and version", async ({ mockPage }) => {
    const page = mockPage;

    await goToSettings(mockPage);
    await page.getByRole("tab", { name: "About" }).click();

    const aboutPanel = page.getByTestId("about-panel");
    await expect(aboutPanel.getByText("Connection", { exact: true })).toBeVisible();
    await expect(aboutPanel.getByText("Connected", { exact: true })).toBeVisible();
    await expect(aboutPanel.getByText("Version", { exact: true })).toBeVisible();
  });

  test("persona button removed from StatusBar", async ({ mockPage }) => {
    const page = mockPage;

    // The persona button should not exist
    await expect(page.locator('button[title="Personas"]')).not.toBeVisible();

    // The settings sidebar tab should still exist
    await expect(page.locator('[data-testid="sidebar-tab-settings"]')).toBeVisible();
  });

  test("breadcrumbs always show Home > Settings on all tabs", async ({ mockPage }) => {
    const page = mockPage;

    await goToSettings(mockPage);
    const breadcrumbs = page.getByTestId("breadcrumbs");

    const tabs = ["Environments", "Credentials", "Personas", "Appearance", "About"];
    for (const tab of tabs) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(breadcrumbs).toContainText("Home");
      await expect(breadcrumbs).toContainText("Settings");
    }
  });

  test("Appearance tab shows theme picker", async ({ mockPage }) => {
    const page = mockPage;

    await goToSettings(mockPage);
    await page.getByRole("tab", { name: "Appearance" }).click();

    await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
    await expect(page.getByText("Choose how Grackle looks")).toBeVisible();
    await expect(page.getByText("Match system light/dark preference")).toBeVisible();
  });
});
