import { test, expect } from "./fixtures.js";
import { stubScenario, emitText, idle } from "./helpers.js";

test.describe("Escalation auto-detection", () => {
  test("creates escalation when standalone task goes idle", async ({ stubTask, grackle: { client } }) => {
    const { page } = stubTask;

    // Create a standalone task (no parent) with a stub scenario that goes idle
    await stubTask.createAndNavigate(
      "escalation-auto-test",
      stubScenario(emitText("I need help with the auth design"), idle()),
    );

    // Start the task
    await page.getByTestId("task-header-start").click();

    // Wait for idle — input field appears
    await page.locator('input[placeholder="Type a message..."]').waitFor({ timeout: 15_000 });

    // Poll for escalation to appear (auto-detection fires on task.updated event)
    const deadline = Date.now() + 10_000;
    let found = false;
    while (Date.now() < deadline) {
      const resp = await client.orchestration.listEscalations({ workspaceId: "", status: "", limit: 50 });
      const match = resp.escalations.find((e) =>
        e.title === "escalation-auto-test" && e.source === "auto",
      );
      if (match) {
        expect(match.status).toBe("delivered");
        expect(match.urgency).toBe("normal");
        expect(match.taskUrl).toContain("/tasks/");
        found = true;
        break;
      }
      await new Promise((r) => { setTimeout(r, 500); });
    }
    expect(found, "Auto-escalation should be created when standalone task goes idle").toBe(true);
  });

  test("escalation list filters by status", async ({ stubTask, grackle: { client } }) => {
    // Create two escalations
    const esc1 = await client.orchestration.createEscalation({
      workspaceId: "", taskId: "", title: "Pending one",
      message: "First", urgency: "normal",
    });
    const esc2 = await client.orchestration.createEscalation({
      workspaceId: "", taskId: "", title: "To acknowledge",
      message: "Second", urgency: "normal",
    });

    // Acknowledge the second one
    await client.orchestration.acknowledgeEscalation({ id: esc2.id });

    // Filter by delivered — only esc1 should match
    const delivered = await client.orchestration.listEscalations({ workspaceId: "", status: "delivered" });
    expect(delivered.escalations.some((e) => e.id === esc1.id)).toBe(true);
    expect(delivered.escalations.some((e) => e.id === esc2.id)).toBe(false);

    // Filter by acknowledged — only esc2 should match
    const acknowledged = await client.orchestration.listEscalations({ workspaceId: "", status: "acknowledged" });
    expect(acknowledged.escalations.some((e) => e.id === esc2.id)).toBe(true);
  });

  test("explicit escalation via RPC", async ({ stubTask, grackle: { client } }) => {
    // Create an escalation via the RPC directly (simulating what the MCP tool does)
    const esc = await client.orchestration.createEscalation({
      workspaceId: "",
      taskId: "",
      title: "Manual escalation",
      message: "Testing explicit escalation via RPC",
      urgency: "high",
    });

    expect(esc.id).toBeTruthy();
    expect(esc.source).toBe("explicit");
    expect(esc.urgency).toBe("high");
    expect(esc.status).toBe("delivered");

    // Acknowledge it
    const acked = await client.orchestration.acknowledgeEscalation({ id: esc.id });
    expect(acked.status).toBe("acknowledged");
    expect(acked.acknowledgedAt).toBeTruthy();

    // List and verify
    const list = await client.orchestration.listEscalations({ workspaceId: "", status: "acknowledged" });
    const found = list.escalations.find((e) => e.id === esc.id);
    expect(found).toBeDefined();
    expect(found!.status).toBe("acknowledged");
  });
});
