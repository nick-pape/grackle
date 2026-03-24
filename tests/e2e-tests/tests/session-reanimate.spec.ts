/**
 * E2E tests for unified session resume (issue #576).
 *
 * Verifies that `resume_agent` correctly reanimates a stopped (killed) stub
 * session, and that active sessions (idle/running/pending) are rejected with
 * an error.
 */
import { test, expect } from "./fixtures.js";
import { sendWsAndWaitFor, sendWsAndWaitForError, sendWsMessage } from "./helpers.js";

test.describe("Session Reanimate (stub runtime)", { tag: ["@session"] }, () => {
  // Kill any stale active sessions from previous specs so the shared
  // test-local environment is clean before each test in this file.
  test.beforeEach(async ({ appPage }) => {
    const sessionsResp = await sendWsAndWaitFor(
      appPage,
      { type: "list_sessions" },
      "sessions",
    );
    const all = (sessionsResp.payload?.sessions ?? []) as Array<{ id: string; status: string }>;
    const active = all.filter((s) => s.status === "idle" || s.status === "running" || s.status === "pending");
    for (const s of active) {
      await sendWsMessage(appPage, { type: "kill", payload: { sessionId: s.id } });
    }
    // Wait until the environment has no active sessions before proceeding.
    if (active.length > 0) {
      // Poll via ConnectRPC until no active sessions remain
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const recheck = await sendWsAndWaitFor(
          appPage,
          { type: "list_sessions" },
          "sessions",
        );
        const remaining = (recheck.payload?.sessions ?? []) as Array<{ status: string }>;
        const anyActive = remaining.some(
          (s) => s.status === "idle" || s.status === "running" || s.status === "pending",
        );
        if (!anyActive) {
          break;
        }
        await appPage.waitForTimeout(250);
      }
    }
  });

  test("resume a killed session reanimates it to idle, accepts input, and can be killed again", async ({ appPage }) => {
    const page = appPage;

    // ── 1. Spawn a stub session from the UI (uses default stub persona) ──
    await page.locator('[data-testid="sidebar-tab-environments"]').click();
    await page.getByTestId("env-nav-item").first().click();
    await page.getByRole("button", { name: "New Chat" }).click();

    const promptInput = page.locator('input[placeholder="Enter prompt..."]');
    await promptInput.fill("reanimate me");
    await page.locator("button", { hasText: "Go" }).click();

    // ── 2. Wait for the session to reach waiting_input ──────────────────
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=Echo: reanimate me")).toBeVisible();

    // ── 3. Session is idle — kill it to move to STOPPED ──────────────────
    await page.locator("button", { hasText: "Stop" }).click();
    await expect(page.locator("text=Session killed")).toBeVisible({ timeout: 10_000 });

    // ── 4. Find the killed session ID via WS ────────────────────────────
    // Pick the most recently started stopped/killed stub session (other specs may
    // have also left stopped stub sessions in the DB).
    const sessionsResp = await sendWsAndWaitFor(
      page,
      { type: "list_sessions", payload: { status: "stopped" } },
      "sessions",
    );
    const sessions = (sessionsResp.payload?.sessions ?? []) as Array<{
      id: string; status: string; endReason: string; runtime: string; startedAt: string;
    }>;
    const killed = sessions
      .filter((s) => s.status === "stopped" && s.endReason === "killed" && s.runtime === "stub")
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    expect(killed, "Expected a killed stub session").toBeTruthy();
    const sessionId = killed.id;

    // ── 5. Reanimate via ConnectRPC resume_agent ───────────────────────────
    const resumeResult = await sendWsAndWaitFor(
      page,
      { type: "resume_agent", payload: { sessionId } },
      "agent_resumed",
      10_000,
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

    // ── 8. Session returns to idle — kill it to stop ─────────────────────
    await expect(resumedInput).toBeVisible({ timeout: 10_000 });
    await page.locator("button", { hasText: "Stop" }).click();
    await expect(page.locator("text=Session killed")).toBeVisible({ timeout: 10_000 });
  });

  test("resume an idle (active) session returns an error", async ({ appPage }) => {
    const page = appPage;

    // Spawn and wait for the stub session to reach waiting_input (idle)
    await page.locator('[data-testid="sidebar-tab-environments"]').click();
    await page.getByTestId("env-nav-item").first().click();
    await page.getByRole("button", { name: "New Chat" }).click();

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
    await expect(page.locator("text=Session killed")).toBeVisible({ timeout: 5_000 });
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
