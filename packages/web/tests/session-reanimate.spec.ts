/**
 * E2E tests for unified session resume (issue #576).
 *
 * Verifies that `resume_agent` correctly reanimates a completed stub session,
 * and that the backward-compat path (idle session) returns as-is.
 */
import { test, expect } from "./fixtures.js";
import { sendWsAndWaitFor, sendWsAndWaitForError } from "./helpers.js";

test.describe("Session Reanimate (stub runtime)", () => {
  test("resume a completed session reanimates it to idle, accepts input, and completes again", async ({ appPage }) => {
    const page = appPage;

    // ── 1. Spawn a stub session from the UI (uses default stub persona) ──
    await page.locator('button[title="Settings"]').click();
    await page.locator('button[title="New chat"]').click();

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
    // Pick the most recently started completed stub session (other specs may
    // have also left completed stub sessions in the DB).
    const sessionsResp = await sendWsAndWaitFor(
      page,
      { type: "list_sessions", payload: { status: "completed" } },
      "sessions",
    );
    const sessions = (sessionsResp.payload?.sessions ?? []) as Array<{
      id: string; status: string; runtime: string; startedAt: string;
    }>;
    const completed = sessions
      .filter((s) => s.status === "completed" && s.runtime === "stub")
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    expect(completed, "Expected a completed stub session").toBeTruthy();
    const sessionId = completed.id;

    // ── 5. Reanimate via WS resume_agent ──────────────────────────────────
    // Use page.evaluate directly so we can capture either agent_resumed or
    // error (sendWsAndWaitFor times out silently on error).
    const resumeResult = await page.evaluate(
      async ({ sessionId: sid }): Promise<{ type: string; payload: Record<string, unknown> }> => {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(`ws://${window.location.host}`);
          const timer = setTimeout(() => { ws.close(); reject(new Error("WS timeout waiting for resume response")); }, 10_000);
          ws.onmessage = (e: MessageEvent) => {
            const data = JSON.parse(e.data as string) as { type: string; payload: Record<string, unknown> };
            if (data.type === "agent_resumed" || data.type === "error") {
              clearTimeout(timer); ws.close(); resolve(data);
            }
          };
          ws.onerror = () => { clearTimeout(timer); ws.close(); reject(new Error("WS error")); };
          ws.onopen = () => { ws.send(JSON.stringify({ type: "resume_agent", payload: { sessionId: sid } })); };
        });
      },
      { sessionId },
    );
    expect(resumeResult.type, `resume_agent failed: ${JSON.stringify(resumeResult.payload)}`).toBe("agent_resumed");
    expect(resumeResult.payload?.sessionId).toBe(sessionId);

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
