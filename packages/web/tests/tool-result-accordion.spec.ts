import { test, expect } from "./fixtures.js";
import {
  installWsTracker,
  injectWsMessage,
} from "./helpers.js";

/**
 * Tests for the tool_result event preview + accordion UI (#303).
 *
 * These tests inject WebSocket messages directly to avoid relying on the
 * stub runtime, which can be flaky in CI.  The approach:
 *   1. installWsTracker + page.goto → "Connected"
 *   2. Inject `spawned` to switch the app into session view mode
 *   3. Inject `session_event` messages to populate the event stream
 *   4. Assert on the rendered output
 *
 * Covers:
 *  - Success indicator (✓) shown for normal tool results
 *  - Error indicator (✗) shown when raw field has is_error=true
 *  - "Tool output" / "Tool error" label
 *  - Preview of first 5 lines inline (no toggle for short content)
 *  - Accordion expand/collapse for results with more than 5 lines
 */

const FAKE_SESSION_ID = "tool-result-test-session-01";

/** Helper: inject a `spawned` message so the app switches to session view. */
async function injectSpawned(
  page: import("@playwright/test").Page,
): Promise<void> {
  await injectWsMessage(page, {
    type: "spawned",
    payload: { sessionId: FAKE_SESSION_ID },
  });
}

/** Helper: inject a tool_result session event. */
async function injectToolResult(
  page: import("@playwright/test").Page,
  content: string,
  raw?: string,
): Promise<void> {
  await injectWsMessage(page, {
    type: "session_event",
    payload: {
      sessionId: FAKE_SESSION_ID,
      eventType: "tool_result",
      content,
      timestamp: new Date().toISOString(),
      ...(raw !== undefined ? { raw } : {}),
    },
  });
}

test.describe("Tool result preview and accordion (#303)", () => {
  /** Navigate to the app, wait for connection, and inject a spawned event so
   *  the app enters session view mode for FAKE_SESSION_ID.
   *
   *  After the `spawned` injection, SessionPanel fires `loadSessionEvents` which
   *  sends a real `get_session_events` request to the server.  The server responds
   *  with an empty `session_events` payload (fake session doesn't exist), which
   *  clears any events for the fake session ID.  We wait until "Waiting for events…"
   *  is visible — that text only appears after the replay response has landed and
   *  the events list is empty — before injecting test events so they cannot be
   *  wiped by the late-arriving replay. */
  async function setupSessionView(
    page: import("@playwright/test").Page,
  ): Promise<void> {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );
    await injectSpawned(page);
    // Wait for "Waiting for events…" which confirms:
    //  1. viewMode switched to session mode
    //  2. server's get_session_events reply arrived (session unknown → empty)
    //  3. safe to inject events; the replay handler won't wipe them afterwards
    await page.waitForFunction(
      () => document.body.innerText.includes("Waiting for events"),
      { timeout: 5_000 },
    );
  }

  test("shows success indicator and tool output label", async ({ page }) => {
    await setupSessionView(page);

    await injectToolResult(page, 'Tool output: "hello world"');

    // Wait for the event card to appear
    const toolResult = page.locator('[class*="toolResultEvent"]');
    await expect(toolResult).toBeVisible({ timeout: 5_000 });

    // Success indicator (✓) should be visible
    await expect(page.locator('[class*="toolResultIndicatorOk"]')).toBeVisible();

    // Label should read "Tool output"
    await expect(page.locator('[class*="toolResultLabel"]')).toHaveText(
      "Tool output",
    );

    // Content preview should appear inline
    await expect(page.locator('[class*="toolResultPre"]')).toContainText(
      "hello world",
    );
  });

  test("short result has no expand toggle", async ({ page }) => {
    await setupSessionView(page);

    // Single-line content — fewer than PREVIEW_LINES=5 lines
    await injectToolResult(page, "Single line result");

    await expect(
      page.locator('[class*="toolResultEvent"]'),
    ).toBeVisible({ timeout: 5_000 });

    // No toggle chevron for short content
    await expect(
      page.locator('[class*="toolResultToggle"]'),
    ).not.toBeVisible();
  });

  test("multi-line result (>5 lines) shows toggle and expands/collapses", async ({ page }) => {
    await setupSessionView(page);

    // 8 lines — exceeds PREVIEW_LINES=5
    const multiLineContent = Array.from(
      { length: 8 },
      (_, i) => `Line ${i + 1} of output`,
    ).join("\n");

    await injectToolResult(page, multiLineContent);

    const lastPre = page.locator('[class*="toolResultPre"]').last();
    await expect(lastPre).toBeVisible({ timeout: 5_000 });

    // Toggle chevron must be present
    const toggle = page.locator('[class*="toolResultToggle"]').last();
    await expect(toggle).toBeVisible();

    // Preview shows lines 1–5 but NOT line 6
    await expect(lastPre).toContainText("Line 5 of output");
    await expect(lastPre).not.toContainText("Line 6 of output");

    // Ellipsis hint visible when collapsed
    await expect(
      page.locator('[class*="toolResultEllipsis"]').last(),
    ).toBeVisible();

    // Expand — all 8 lines should now be visible
    const headerButton = page
      .locator('[class*="toolResultHeader"]:is(button)')
      .last();
    await headerButton.click();
    await expect(lastPre).toContainText("Line 6 of output");
    await expect(lastPre).toContainText("Line 8 of output");

    // Ellipsis disappears when expanded
    await expect(
      page.locator('[class*="toolResultEllipsis"]').last(),
    ).not.toBeVisible();

    // Collapse — line 6 disappears again
    await headerButton.click();
    await expect(lastPre).not.toContainText("Line 6 of output");
  });

  test("error indicator shown when raw field has is_error=true", async ({ page }) => {
    await setupSessionView(page);

    await injectToolResult(
      page,
      "Error: file not found",
      JSON.stringify({ type: "tool_result", is_error: true }),
    );

    // Error indicator (✗) should appear
    await expect(
      page.locator('[class*="toolResultIndicatorError"]'),
    ).toBeVisible({ timeout: 5_000 });

    // Label should read "Tool error"
    await expect(
      page.locator('[class*="toolResultLabel"]').last(),
    ).toHaveText("Tool error");
  });

  test("success indicator used when raw field has is_error=false", async ({ page }) => {
    await setupSessionView(page);

    await injectToolResult(
      page,
      "Success",
      JSON.stringify({ type: "tool_result", is_error: false }),
    );

    await expect(
      page.locator('[class*="toolResultIndicatorOk"]'),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator('[class*="toolResultLabel"]').last(),
    ).toHaveText("Tool output");
  });

  test("success indicator used when raw field is absent", async ({ page }) => {
    await setupSessionView(page);

    // No raw field — should default to success
    await injectToolResult(page, "Result without raw");

    await expect(
      page.locator('[class*="toolResultIndicatorOk"]'),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("raw field is forwarded by backend and accepted by frontend type guard", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Inject a session_event with a raw field — the frontend isSessionEvent guard must accept it
    // without warning, and the event must be added to the events array.
    let droppedByGuard = false;
    await page.evaluate(() => {
      const origWarn = console.warn.bind(console);
      console.warn = (...args: unknown[]) => {
        if (
          typeof args[0] === "string" &&
          args[0].includes("Malformed") &&
          typeof args[1] === "string" &&
          args[1].includes("session_event")
        ) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__sessionEventDropped__ = true;
        }
        origWarn(...args);
      };
    });

    await injectSpawned(page);
    await injectToolResult(
      page,
      "raw-field test",
      JSON.stringify({ type: "tool_result", is_error: false }),
    );

    // The event should render (not dropped by isSessionEvent guard)
    const toolResult = page.locator('[class*="toolResultEvent"]');
    await expect(toolResult).toBeVisible({ timeout: 5_000 });

    // Verify no "Malformed session_event" warning was emitted
    droppedByGuard = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => !!(window as any).__sessionEventDropped__,
    );
    expect(droppedByGuard).toBe(false);
  });
});
