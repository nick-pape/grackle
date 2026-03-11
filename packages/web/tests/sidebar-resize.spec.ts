import { test, expect } from "./fixtures.js";

test.describe("Sidebar Resize", () => {
  test("sidebar renders with default width", async ({ appPage }) => {
    const page = appPage;
    const sidebar = page.locator('[data-testid="sidebar"]');
    const box = await sidebar.boundingBox();
    expect(box).toBeTruthy();
    // Default width is 260px (allow small tolerance for borders/padding)
    expect(box!.width).toBeGreaterThanOrEqual(255);
    expect(box!.width).toBeLessThanOrEqual(270);
  });

  test("sidebar has CSS resize: horizontal", async ({ appPage }) => {
    const page = appPage;
    const sidebar = page.locator('[data-testid="sidebar"]');
    const resize = await sidebar.evaluate((el) => getComputedStyle(el).resize);
    expect(resize).toBe("horizontal");
  });

  test("sidebar width persists to localStorage after resize", async ({ appPage }) => {
    const page = appPage;
    const sidebar = page.locator('[data-testid="sidebar"]');

    // Simulate a resize by setting the width directly
    await sidebar.evaluate((el) => {
      el.style.width = "350px";
    });

    // Wait for ResizeObserver to persist to localStorage
    await page.waitForFunction(
      () => {
        const v = localStorage.getItem("grackle-sidebar-width");
        return v !== null && Number(v) >= 300;
      },
      { timeout: 5_000 },
    );

    const stored = await page.evaluate(() => localStorage.getItem("grackle-sidebar-width"));
    expect(stored).toBeTruthy();
    const storedWidth = Number(stored);
    expect(storedWidth).toBeGreaterThanOrEqual(300);
    expect(storedWidth).toBeLessThanOrEqual(400);
  });

  test("sidebar restores width from localStorage on reload", async ({ appPage }) => {
    const page = appPage;

    // Set a custom width in localStorage
    await page.evaluate(() => localStorage.setItem("grackle-sidebar-width", "400"));

    // Reload the page
    await page.reload();
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    const sidebar = page.locator('[data-testid="sidebar"]');
    const box = await sidebar.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThanOrEqual(390);
    expect(box!.width).toBeLessThanOrEqual(410);

    // Clean up
    await page.evaluate(() => localStorage.removeItem("grackle-sidebar-width"));
  });

  test("sidebar ignores invalid localStorage values", async ({ appPage }) => {
    const page = appPage;

    // Set an invalid value
    await page.evaluate(() => localStorage.setItem("grackle-sidebar-width", "not-a-number"));

    await page.reload();
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    const sidebar = page.locator('[data-testid="sidebar"]');
    const box = await sidebar.boundingBox();
    expect(box).toBeTruthy();
    // Should fall back to default 260px
    expect(box!.width).toBeGreaterThanOrEqual(255);
    expect(box!.width).toBeLessThanOrEqual(270);

    // Clean up
    await page.evaluate(() => localStorage.removeItem("grackle-sidebar-width"));
  });

  test("sidebar ignores out-of-range localStorage values", async ({ appPage }) => {
    const page = appPage;

    // Set a value below minimum
    await page.evaluate(() => localStorage.setItem("grackle-sidebar-width", "50"));

    await page.reload();
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    const sidebar = page.locator('[data-testid="sidebar"]');
    const box = await sidebar.boundingBox();
    expect(box).toBeTruthy();
    // Should fall back to default 260px (50 is below MIN_SIDEBAR_WIDTH)
    expect(box!.width).toBeGreaterThanOrEqual(255);
    expect(box!.width).toBeLessThanOrEqual(270);

    // Clean up
    await page.evaluate(() => localStorage.removeItem("grackle-sidebar-width"));
  });

  test("sidebar respects min-width constraint", async ({ appPage }) => {
    const page = appPage;
    const sidebar = page.locator('[data-testid="sidebar"]');

    // Try to set width below minimum
    await sidebar.evaluate((el) => {
      el.style.width = "100px";
    });

    const box = await sidebar.boundingBox();
    expect(box).toBeTruthy();
    // CSS min-width: 180px should prevent it from going below 180
    expect(box!.width).toBeGreaterThanOrEqual(175);
  });

  test("sidebar respects max-width constraint", async ({ appPage }) => {
    const page = appPage;
    const sidebar = page.locator('[data-testid="sidebar"]');

    // Try to set width above maximum
    await sidebar.evaluate((el) => {
      el.style.width = "800px";
    });

    const box = await sidebar.boundingBox();
    expect(box).toBeTruthy();
    // CSS max-width: 500px should cap it
    expect(box!.width).toBeLessThanOrEqual(510);
  });
});
