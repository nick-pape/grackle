import { test, expect } from "./fixtures.js";

test.describe("Authentication & Connection", () => {
  test("page loads successfully", async ({ appPage }) => {
    await expect(appPage.locator("body")).toContainText("Grackle");
  });

  test("StatusBar shows Connected", async ({ appPage }) => {
    const statusBar = appPage.locator("text=Connected");
    await expect(statusBar).toBeVisible();
  });

  test("StatusBar shows environment count", async ({ appPage }) => {
    await expect(appPage.locator("text=1 env")).toBeVisible();
  });

  test("StatusBar shows active session count", async ({ appPage }) => {
    await expect(appPage.getByText(/\d+ active/)).toBeVisible();
  });
});
