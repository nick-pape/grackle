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

test.describe("Tool result preview and accordion (#303)", { tag: ["@webui"] }, () => {
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

  // "multi-line result expand/collapse" removed — covered by EventRenderer.stories.tsx (MultiLineExpandCollapse).

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

  test("paired tool_use+tool_result shows tool name, command preview, and hides standalone tool_use card", async ({ page }) => {
    await setupSessionView(page);

    const TOOL_USE_ID = "toolu_test_pairing_001";

    // Inject tool_use with a structured raw block (mimics claude-code runtime output)
    await injectWsMessage(page, {
      type: "session_event",
      payload: {
        sessionId: FAKE_SESSION_ID,
        eventType: "tool_use",
        content: JSON.stringify({ tool: "Bash", args: { command: "ls -la /tmp" } }),
        timestamp: new Date().toISOString(),
        raw: JSON.stringify({ type: "tool_use", id: TOOL_USE_ID, name: "Bash", input: { command: "ls -la /tmp" } }),
      },
    });

    // Inject matching tool_result
    await injectWsMessage(page, {
      type: "session_event",
      payload: {
        sessionId: FAKE_SESSION_ID,
        eventType: "tool_result",
        content: "total 12\ndrwxrwxrwt 5 root root 4096 Mar 14",
        timestamp: new Date().toISOString(),
        raw: JSON.stringify({ type: "tool_result", tool_use_id: TOOL_USE_ID, is_error: false }),
      },
    });

    // Result card must show "Bash" as the label (tool name, not generic "Tool output")
    await expect(page.locator('[class*="toolResultLabel"]')).toHaveText("Bash", { timeout: 5_000 });

    // Command preview line must show the actual bash command
    await expect(page.locator('[class*="toolResultCommand"]')).toHaveText("ls -la /tmp");

    // The standalone tool_use card (blue-bordered box with JSON args) must be gone —
    // the tool_use event was consumed by its paired result
    await expect(page.locator('[class*="toolUseEvent"]')).not.toBeVisible();
  });

  test("unpaired tool_use (no raw id) still renders as its own card", async ({ page }) => {
    await setupSessionView(page);

    // Inject tool_use without raw → cannot be paired
    await injectWsMessage(page, {
      type: "session_event",
      payload: {
        sessionId: FAKE_SESSION_ID,
        eventType: "tool_use",
        content: JSON.stringify({ tool: "echo", args: { message: "hello" } }),
        timestamp: new Date().toISOString(),
      },
    });

    // Standalone tool_use card must still render
    await expect(page.locator('[class*="toolUseEvent"]')).toBeVisible({ timeout: 5_000 });
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
