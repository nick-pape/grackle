import { test, expect } from "./fixtures.js";
import { stubScenario, emitText, idle } from "./helpers.js";

test.describe("Channel webhook ingestion", { tag: ["@channel"] }, () => {
  test("expose a session, inject a user message via webhook, then revoke", async ({ stubTask, grackle }) => {
    const { page, client } = stubTask;

    // Start a stub session that goes idle and echoes any input as "You said: ...".
    await stubTask.createAndNavigate("webhook inject", stubScenario(
      emitText("Ready for input..."),
      idle(),
    ));
    await page.getByTestId("task-header-start").click();
    await expect(page.getByText("Ready for input...", { exact: true })).toBeVisible({ timeout: 15_000 });

    // Resolve the live session id (the only non-terminal session on this worker stack).
    const sessions = await client.core.listSessions({});
    const live = [...sessions.sessions].reverse().find((s) => s.status !== "stopped");
    expect(live, "a live session should exist").toBeTruthy();
    const sessionId = live!.id;

    // Mint a capability token exposing the session for inbound messages.
    const grant = await client.core.exposeChannel({
      target: { case: "sessionId", value: sessionId },
      verbs: ["send_input"],
      ttlSeconds: 0,
      label: "e2e",
    });
    expect(grant.channelUri).toBe(`grackle:/sessions/${sessionId}`);
    expect(grant.ingressUrl).toContain("/hook/");

    // POST a message to the webhook URL — capability token only, no API key.
    const ok = await fetch(grant.ingressUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello from webhook" }),
    });
    expect(ok.status).toBe(200);

    // The stub agent echoes the injected input back into the session stream.
    await expect(page.getByText("You said: hello from webhook", { exact: true })).toBeVisible({ timeout: 10_000 });

    // An oversized body (>16 KB) is rejected with a clean 413, not a connection reset.
    const tooBig = await fetch(grant.ingressUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "x".repeat(20_000) }),
    });
    expect(tooBig.status).toBe(413);

    // Revoke the grant — the same URL must now be rejected.
    await client.core.revokeChannelGrant({ grantId: grant.grantId });
    const rejected = await fetch(grant.ingressUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "should be rejected" }),
    });
    expect(rejected.status).toBe(403);
  });
});
