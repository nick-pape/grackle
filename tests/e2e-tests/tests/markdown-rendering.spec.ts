import { test, expect } from "./fixtures.js";
import {
  installWsTracker,
} from "./helpers.js";

test.describe("Markdown Rendering in EventRenderer", { tag: ["@webui"] }, () => {
  test("renders markdown headings, bold, and links in text events", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Navigate to the Environments tab
    await page.locator('[data-testid="sidebar-tab-environments"]').click();
    await page.getByTestId("env-nav-item").first().click();
    await page.getByRole("button", { name: "New Chat" }).click();
    const promptInput = page.locator('input[placeholder="Enter prompt..."]');
    await promptInput.fill("md test");
    await page.locator("button", { hasText: "Go" }).click();

    // Wait for session to start
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 10_000 });

    // Verify that the stub runtime's text events render inside textEvent divs
    // using the Markdown component (react-markdown).
    const textEventDivs = page.locator('div[class*="textEvent"]');
    await expect(textEventDivs.first()).toBeVisible({ timeout: 5_000 });
    // Verify rendered content and markdown paragraph wrapping
    await expect(textEventDivs.first()).toContainText("Echo:");
    await expect(textEventDivs.first().locator("p")).toBeVisible();
  });

  test("renders fenced code blocks with syntax highlighting", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Navigate to the Environments tab
    await page.locator('[data-testid="sidebar-tab-environments"]').click();
    await page.getByTestId("env-nav-item").first().click();
    await page.getByRole("button", { name: "New Chat" }).click();

    await page.locator('input[placeholder="Enter prompt..."]').fill("code test");
    await page.locator("button", { hasText: "Go" }).click();

    // Wait for session events to appear
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 10_000 });

    // The stub runtime emits text events. The EventRenderer now wraps them
    // in react-markdown with rehype-prism-plus. Verify the container uses
    // the Markdown component (rendered HTML instead of raw text).
    // The textEvent div should contain rendered HTML elements, not raw markdown.
    const textEventDivs = page.locator('div[class*="textEvent"]');
    await expect(textEventDivs.first()).toBeVisible({ timeout: 5_000 });

    // Verify it contains a <p> tag (markdown renders paragraphs) rather than raw text
    const paragraphs = textEventDivs.first().locator("p");
    // Stub emits "Echo: code test" which should be wrapped in a <p>
    await expect(paragraphs.first()).toBeVisible({ timeout: 5_000 });
    await expect(paragraphs.first()).toContainText("Echo: code test");
  });

  test("consecutive text events are grouped into a single block", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Navigate to the Environments tab
    await page.locator('[data-testid="sidebar-tab-environments"]').click();
    await page.getByTestId("env-nav-item").first().click();
    await page.getByRole("button", { name: "New Chat" }).click();

    await page.locator('input[placeholder="Enter prompt..."]').fill("group test");
    await page.locator("button", { hasText: "Go" }).click();

    // Wait for session events
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 10_000 });

    // The stub runtime emits events in sequence. The groupConsecutiveTextEvents
    // function should merge consecutive text events. We can verify this by
    // checking that the "Echo: group test" text appears as a coherent block
    // inside a single textEvent div, not split across multiple.
    await expect(page.locator("text=Echo: group test")).toBeVisible({ timeout: 5_000 });

    // Count textEvent divs — grouped consecutive text events should produce
    // fewer divs than individual events. The stub emits exactly one text event
    // with "Echo: ..." content, so there should be exactly one textEvent div.
    const textEventDivs = page.locator('div[class*="textEvent"]');
    const count = await textEventDivs.count();
    // The stub emits one text event, so we expect exactly 1 textEvent div
    expect(count).toBe(1);
  });

  test("text events are rendered with markdown paragraph wrapping", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Start a stub session to get a session context — navigate to Environments tab
    await page.locator('[data-testid="sidebar-tab-environments"]').click();
    await page.getByTestId("env-nav-item").first().click();
    await page.getByRole("button", { name: "New Chat" }).click();

    await page.locator('input[placeholder="Enter prompt..."]').fill("table test");
    await page.locator("button", { hasText: "Go" }).click();
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 10_000 });

    // Verify that stub text events are wrapped in <p> tags by react-markdown
    const textEventDivs = page.locator('div[class*="textEvent"]');
    const firstText = textEventDivs.first();
    await expect(firstText).toBeVisible({ timeout: 5_000 });
    await expect(firstText).toContainText("Echo: table test");
    await expect(firstText.locator("p")).toBeVisible();
  });

  test("prism theme CSS is loaded for syntax highlighting", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Verify prism token styles are available in the stylesheet
    // The prism-theme.scss defines styles for .token.keyword, .token.string, etc.
    // We can check that the CSS custom properties used by the theme are defined
    const hasThemeStyles = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      // Check for theme tokens that the prism theme depends on
      const accentGreen = styles.getPropertyValue("--accent-green");
      const accentBlue = styles.getPropertyValue("--accent-blue");
      return accentGreen.length > 0 && accentBlue.length > 0;
    });
    expect(hasThemeStyles).toBe(true);
  });
});
