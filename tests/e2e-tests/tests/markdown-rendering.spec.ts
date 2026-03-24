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

    await stubTask.createAndNavigate("heading-test", stubScenario(
      emitText("# Heading One"),
      emitText("## Heading Two"),
      emitText("### Heading Three"),
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
    await expect(page.locator("h1").filter({ hasText: "Heading One" })).toBeVisible();
    await expect(page.locator("h2").filter({ hasText: "Heading Two" })).toBeVisible();
    await expect(page.locator("h3").filter({ hasText: "Heading Three" })).toBeVisible();
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
    await expect(page.locator("strong").filter({ hasText: "bold text" })).toBeVisible();
    await expect(page.locator("em").filter({ hasText: "italic text" })).toBeVisible();
    await expect(page.locator("a").filter({ hasText: "a link" })).toHaveAttribute("href", "https://example.com");
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

    // All three consecutive text events should be grouped into a single textEvent div
    await expect(page.locator("text=Line one of grouped text")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=Line two of grouped text")).toBeVisible();
    await expect(page.locator("text=Line three of grouped text")).toBeVisible();

    // Grouped consecutive text events produce fewer divs than individual events
    const textEventDivs = page.locator('div[class*="textEvent"]');
    const count = await textEventDivs.count();
    expect(count).toBe(1);
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
