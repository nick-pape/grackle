import { test, expect } from "./fixtures.js";

test.describe("Authentication & Connection", { tag: ["@error", "@smoke"] }, () => {
  test("page loads successfully", async ({ appPage }) => {
    await expect(appPage.locator("body")).toContainText("Grackle");
  });

  test("StatusBar shows Connected", async ({ appPage }) => {
    const statusBar = appPage.getByLabel("Connected");
    await expect(statusBar).toBeVisible();
  });

  test("StatusBar shows environment count", async ({ appPage }) => {
    await expect(appPage.getByText(/\d+\/\d+ env/).first()).toBeVisible();
  });

  test("StatusBar shows active session count", async ({ appPage }) => {
    await expect(appPage.getByText(/\d+ active/)).toBeVisible();
  });
});
