/**
 * E2E tests for unified session resume (issue #576).
 *
 * Verifies that `resume_agent` correctly reanimates a completed stub session,
 * and that the backward-compat path (idle session) returns as-is.
 */
import { test, expect } from "./fixtures.js";
import { getNewChatRuntimeSelect, sendWsAndWaitFor, sendWsAndWaitForError } from "./helpers.js";

test.describe("Session Reanimate (stub runtime)", () => {
  test("resume a completed session reanimates it to idle, accepts input, and completes again", async ({ appPage }) => {
    const page = appPage;

    // ── 1. Spawn a stub session from the UI ─────────────────────────────
    await page.locator('button[title="Settings"]').click();
    await page.locator('button[title="New chat"]').click();

    const runtimeSelect = getNewChatRuntimeSelect(page);
    await runtimeSelect.selectOption("stub");

    const promptInput = page.locator('input[placeholder="Enter prompt..."]');
    await promptInput.fill("reanimate me");
    await page.locator("button", { hasText: "Go" }).click();

    // ── 2. Wait for the session to reach waiting_input ──────────────────
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=Echo: reanimate me")).toBeVisible();

    // ── 3. Send input to complete the session ────────────────────────────
    await inputField.fill("finish");
    await page.locator("button", { hasText: "Send" }).click();
    await expect(page.locator("text=Session completed")).toBeVisible({ timeout: 10_000 });

    // ── 4. Find the completed session ID via WS ───────────────────────────
    const sessionsResp = await sendWsAndWaitFor(
      page,
      { type: "list_sessions", payload: { status: "completed" } },
      "sessions",
    );
    const sessions = (sessionsResp.payload?.sessions ?? []) as Array<{ id: string; status: string; runtime: string }>;
    const completed = sessions.find((s) => s.status === "completed" && s.runtime === "stub");
    expect(completed, "Expected a completed stub session").toBeTruthy();
    const sessionId = completed!.id;

    // ── 5. Reanimate via WS resume_agent ──────────────────────────────────
    const resumeResp = await sendWsAndWaitFor(
      page,
      { type: "resume_agent", payload: { sessionId } },
      "agent_resumed",
    );
    expect(resumeResp.payload?.sessionId).toBe(sessionId);

    // ── 6. UI transitions: session re-enters waiting_input ────────────────
    // The stub resume emits "Echo: (resumed session)" as its first text event
    await expect(page.locator("text=Echo: (resumed session)")).toBeVisible({ timeout: 10_000 });
    const resumedInput = page.locator('input[placeholder="Type a message..."]');
    await expect(resumedInput).toBeVisible({ timeout: 10_000 });

    // ── 7. Send input to the reanimated session ───────────────────────────
    await resumedInput.fill("hello after resume");
    await page.locator("button", { hasText: "Send" }).click();

    await expect(page.locator("text=You said: hello after resume")).toBeVisible({ timeout: 10_000 });

    // ── 8. Session completes again ────────────────────────────────────────
    await expect(page.locator("text=Session completed")).toBeVisible({ timeout: 10_000 });
  });

  test("resume an idle (active) session returns an error", async ({ appPage }) => {
    const page = appPage;

    // Spawn and wait for the stub session to reach waiting_input (idle)
    await page.locator('button[title="Settings"]').click();
    await page.locator('button[title="New chat"]').click();

    const runtimeSelect = getNewChatRuntimeSelect(page);
    await runtimeSelect.selectOption("stub");
    await page.locator('input[placeholder="Enter prompt..."]').fill("keep idle");
    await page.locator("button", { hasText: "Go" }).click();

    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 10_000 });

    // Get the idle session ID
    const sessionsResp = await sendWsAndWaitFor(
      page,
      { type: "list_sessions", payload: { status: "idle" } },
      "sessions",
    );
    const sessions = (sessionsResp.payload?.sessions ?? []) as Array<{ id: string; status: string; runtime: string }>;
    const idleSession = sessions.find((s) => s.status === "idle" && s.runtime === "stub");
    expect(idleSession, "Expected an idle stub session").toBeTruthy();

    // Resuming an IDLE session should error — it is already active
    const errResp = await sendWsAndWaitForError(
      page,
      { type: "resume_agent", payload: { sessionId: idleSession!.id } },
    );
    expect(errResp.payload?.message).toContain("already active");

    // Session is still running normally
    await expect(inputField).toBeVisible();

    // Cleanup
    await page.locator("button", { hasText: "Stop" }).click();
    await expect(page.locator("text=Session interrupted")).toBeVisible({ timeout: 5_000 });
  });

  test("resume a non-existent session returns an error via WS", async ({ appPage }) => {
    const page = appPage;

    const errResp = await sendWsAndWaitForError(
      page,
      { type: "resume_agent", payload: { sessionId: "no-such-session-id" } },
    );
    expect(errResp.payload?.message).toContain("not found");
  });
});
