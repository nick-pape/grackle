import { test, expect } from "./fixtures.js";
import {
  stubScenario,
  emitText,
  idle,
  onInput,
} from "./helpers.js";

test.describe("Markdown Rendering in EventRenderer", { tag: ["@webui"] }, () => {
  test("renders headings as h1-h3 elements", async ({ stubTask }) => {
    const { page } = stubTask;

    // Emit all headings in a single text event so markdown can parse them
    // (separate emitText calls get grouped/concatenated without newlines)
    await stubTask.createAndNavigate("heading-test", stubScenario(
      emitText("# Heading One\n\n## Heading Two\n\n### Heading Three"),
      onInput("next"),
      idle(),
    ));

    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.locator("text=Stub runtime initialized").waitFor({ timeout: 15_000 });

    // Switch to stream tab to see events
    await page.locator("button", { hasText: "Stream" }).click();

    const textEvents = page.locator('div[class*="textEvent"]');
    await expect(textEvents.first()).toBeVisible({ timeout: 5_000 });

    // react-markdown should render # as <h1>, ## as <h2>, ### as <h3>
    await expect(textEvents.locator("h1").filter({ hasText: "Heading One" })).toBeVisible();
    await expect(textEvents.locator("h2").filter({ hasText: "Heading Two" })).toBeVisible();
    await expect(textEvents.locator("h3").filter({ hasText: "Heading Three" })).toBeVisible();
  });

  test("renders bold, italic, and links", async ({ stubTask }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigate("inline-test", stubScenario(
      emitText("This has **bold text** and *italic text* and [a link](https://example.com)"),
      onInput("next"),
      idle(),
    ));

    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.locator("text=Stub runtime initialized").waitFor({ timeout: 15_000 });

    await page.locator("button", { hasText: "Stream" }).click();

    const textEvents = page.locator('div[class*="textEvent"]');
    await expect(textEvents.first()).toBeVisible({ timeout: 5_000 });

    // Verify inline markdown elements are rendered
    await expect(textEvents.locator("strong").filter({ hasText: "bold text" })).toBeVisible();
    await expect(textEvents.locator("em").filter({ hasText: "italic text" })).toBeVisible();
    await expect(textEvents.locator("a").filter({ hasText: "a link" })).toHaveAttribute("href", "https://example.com");
  });

  test("renders fenced code blocks with pre > code elements", async ({ stubTask }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigate("code-test", stubScenario(
      emitText("```js\nconst x = 42;\nconsole.log(x);\n```"),
      onInput("next"),
      idle(),
    ));

    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.locator("text=Stub runtime initialized").waitFor({ timeout: 15_000 });

    await page.locator("button", { hasText: "Stream" }).click();

    const textEvents = page.locator('div[class*="textEvent"]');
    await expect(textEvents.first()).toBeVisible({ timeout: 5_000 });

    // Fenced code blocks should render as <pre><code>
    // Search all textEvent divs (first one is "Stub runtime initialized")
    const codeBlock = textEvents.locator("pre code");
    await expect(codeBlock.first()).toBeVisible();
    await expect(codeBlock.first()).toContainText("const x = 42");
  });

  test("consecutive text events are grouped into a single block", async ({ stubTask }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigate("group-test", stubScenario(
      emitText("Line one of grouped text"),
      emitText("Line two of grouped text"),
      emitText("Line three of grouped text"),
      onInput("next"),
      idle(),
    ));

    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.locator("text=Stub runtime initialized").waitFor({ timeout: 15_000 });

    await page.locator("button", { hasText: "Stream" }).click();

    // The 3 scenario text events should be grouped into a single textEvent div.
    // (The "Stub runtime initialized" event forms a separate div since a non-text
    // event separates it from the scenario events.)
    const textEventDivs = page.locator('div[class*="textEvent"]');
    await expect(textEventDivs.first()).toBeVisible({ timeout: 5_000 });

    // Find the div that contains our grouped scenario text
    const groupedDiv = textEventDivs.filter({ hasText: "Line one of grouped text" });
    await expect(groupedDiv).toHaveCount(1);
    await expect(groupedDiv).toContainText("Line one of grouped text");
    await expect(groupedDiv).toContainText("Line two of grouped text");
    await expect(groupedDiv).toContainText("Line three of grouped text");
  });

  test("prism theme CSS is loaded for syntax highlighting", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Verify prism token styles are available in the stylesheet
    const hasThemeStyles = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      const accentGreen = styles.getPropertyValue("--accent-green");
      const accentBlue = styles.getPropertyValue("--accent-blue");
      return accentGreen.length > 0 && accentBlue.length > 0;
    });
    expect(hasThemeStyles).toBe(true);
  });
});
