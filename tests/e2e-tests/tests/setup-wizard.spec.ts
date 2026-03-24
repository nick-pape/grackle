import { test, expect } from "./fixtures.js";
import { sendWsMessage } from "./helpers.js";

/**
 * Helper: set onboarding_completed via a direct WebSocket connection.
 * Uses sendWsMessage which opens a WS, sends the message, waits briefly
 * for server processing, then closes. Works regardless of current route.
 */
async function setOnboardingCompleted(
  page: import("@playwright/test").Page,
  value: "true" | "false",
): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await sendWsMessage(page, {
    type: "set_setting",
    payload: { key: "onboarding_completed", value },
  });
}

// Run tests serially — they share server state (onboarding_completed setting).
test.describe.configure({ mode: "serial" });

test.describe("Setup Wizard (FRE)", { tag: ["@settings"] }, () => {
  test("redirects to /setup when onboarding is incomplete", async ({ page }) => {
    await setOnboardingCompleted(page, "false");

    await page.goto("/");
    await page.waitForURL("**/setup", { timeout: 10_000 });
    await expect(page.getByTestId("setup-wizard")).toBeVisible();
    await expect(page.getByText("Welcome to Grackle")).toBeVisible();
  });

  test("back buttons navigate between steps", async ({ page }) => {
    // Onboarding is still false from the previous test
    await page.goto("/");
    await page.waitForURL("**/setup", { timeout: 10_000 });

    // Welcome → About
    await page.getByTestId("setup-get-started").click();
    await expect(page.getByTestId("setup-about")).toBeVisible();

    // About → back to Welcome
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByTestId("setup-welcome")).toBeVisible();

    // Welcome → About → Runtime
    await page.getByTestId("setup-get-started").click();
    await page.getByTestId("setup-about-next").click();
    await expect(page.getByTestId("setup-runtime")).toBeVisible();

    // Runtime → back to About
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByTestId("setup-about")).toBeVisible();
  });

  test("walks through all three steps and completes", async ({ page }) => {
    // Onboarding is still false
    await page.goto("/");
    await page.waitForURL("**/setup", { timeout: 10_000 });

    // Step 0: Welcome
    await expect(page.getByTestId("setup-welcome")).toBeVisible();
    await page.getByTestId("setup-get-started").click();

    // Step 1: About
    await expect(page.getByTestId("setup-about")).toBeVisible();
    await page.getByTestId("setup-about-next").click();

    // Step 2: Runtime — claude-code should be pre-selected
    await expect(page.getByTestId("setup-runtime")).toBeVisible();
    await expect(page.getByTestId("runtime-card-claude-code")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("runtime-card-copilot")).toHaveAttribute("aria-pressed", "false");

    // Select a different runtime
    await page.getByTestId("runtime-card-copilot").click();
    await expect(page.getByTestId("runtime-card-copilot")).toHaveAttribute("aria-pressed", "true");

    // Finish — should navigate to /
    await page.getByTestId("setup-finish").click();
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );
  });

  test("does not show wizard after onboarding is complete", async ({ page }) => {
    // Onboarding was just completed by the previous test
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );
    await expect(page.getByTestId("setup-wizard")).not.toBeVisible();
  });

  test("/setup redirects to / when onboarding is already complete", async ({ page }) => {
    // Onboarding is still complete
    await page.goto("/setup");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );
    await expect(page.getByTestId("setup-wizard")).not.toBeVisible();
  });

  // Restore onboarding_completed so other specs sharing this worker aren't affected.
  test("cleanup: restore onboarding state", async ({ page }) => {
    await setOnboardingCompleted(page, "true");
  });
});
