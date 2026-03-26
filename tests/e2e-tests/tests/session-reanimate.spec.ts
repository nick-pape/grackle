/**
 * E2E tests for unified session resume (issue #576).
 *
 * Verifies that `resume_agent` correctly reanimates a stopped (killed) stub
 * session, and that active sessions (idle/running/pending) are rejected with
 * an error.
 */
import { test, expect } from "./fixtures.js";

test.describe("Session Reanimate (stub runtime)", { tag: ["@session"] }, () => {
  // Kill any stale active sessions from previous specs so the shared
  // test-local environment is clean before each test in this file.
  test.beforeEach(async ({ appPage, grackle: { client } }) => {
    const sessionsResp = await client.listSessions({});
    const all = sessionsResp.sessions as Array<{ id: string; status: string }>;
    const active = all.filter((s) => s.status === "idle" || s.status === "running" || s.status === "pending");
    for (const s of active) {
      await client.killAgent({ id: s.id });
    }
    // Wait until the environment has no active sessions before proceeding.
    if (active.length > 0) {
      await expect(async () => {
        const recheck = await client.listSessions({});
        const remaining = recheck.sessions as Array<{ status: string }>;
        const anyActive = remaining.some(
          (s) => s.status === "idle" || s.status === "running" || s.status === "pending",
        );
        expect(anyActive).toBe(false);
      }).toPass({ timeout: 5_000, intervals: [250] });
    }
  });

  test("resume a killed session reanimates it to idle, accepts input, and can be killed again", async ({ appPage, grackle: { client } }) => {
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
    await page.getByTestId("stop-split-button-chevron").waitFor({ timeout: 10_000 });
    await page.getByTestId("stop-split-button-chevron").click();
    await page.locator("[data-testid='stop-split-button-menu'] button", { hasText: "Kill" }).click();
    await expect(page.locator("text=Session killed")).toBeVisible({ timeout: 10_000 });

    // ── 4. Find the killed session ID via RPC ────────────────────────────
    // Pick the most recently started stopped/killed stub session (other specs may
    // have also left stopped stub sessions in the DB).
    const sessionsResp = await client.listSessions({ status: "stopped" });
    const sessions = sessionsResp.sessions as Array<{
      id: string; status: string; endReason: string; runtime: string; startedAt: string;
    }>;
    const killed = sessions
      .filter((s) => s.status === "stopped" && s.endReason === "killed" && s.runtime === "stub")
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    expect(killed, "Expected a killed stub session").toBeTruthy();
    const sessionId = killed.id;

    // ── 5. Reanimate via ConnectRPC resume_agent ───────────────────────────
    const resumeResult = await client.resumeAgent({ sessionId });
    expect(resumeResult.id).toBeTruthy();

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
    await page.getByTestId("stop-split-button-chevron").waitFor({ timeout: 10_000 });
    await page.getByTestId("stop-split-button-chevron").click();
    await page.locator("[data-testid='stop-split-button-menu'] button", { hasText: "Kill" }).click();
    await expect(page.locator("text=Session killed")).toBeVisible({ timeout: 10_000 });
  });

  test("resume an idle (active) session returns an error", async ({ appPage, grackle: { client } }) => {
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
    const sessionsResp = await client.listSessions({ status: "idle" });
    const sessions = sessionsResp.sessions as Array<{ id: string; status: string; runtime: string }>;
    const idleSession = sessions.find((s) => s.status === "idle" && s.runtime === "stub");
    expect(idleSession, "Expected an idle stub session").toBeTruthy();

    // Resuming an IDLE session should error — it is already active
    let error: Error | undefined;
    try {
      await client.resumeAgent({ sessionId: idleSession!.id });
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toContain("already active");

    // Session is still running normally
    await expect(inputField).toBeVisible();

    // Cleanup
    await page.getByTestId("stop-split-button-chevron").waitFor({ timeout: 10_000 });
    await page.getByTestId("stop-split-button-chevron").click();
    await page.locator("[data-testid='stop-split-button-menu'] button", { hasText: "Kill" }).click();
    await expect(page.locator("text=Session killed")).toBeVisible({ timeout: 5_000 });
  });

  test("resume a non-existent session returns an error via RPC", async ({ grackle: { client } }) => {
    let error: Error | undefined;
    try {
      await client.resumeAgent({ sessionId: "no-such-session-id" });
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toContain("not found");
  });
});
