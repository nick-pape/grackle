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
      const resp = await client.listEscalations({ workspaceId: "", status: "", limit: 50 });
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

  test("does NOT create escalation for child tasks", async ({ stubTask, grackle: { client } }) => {
    const { page } = stubTask;

    // Create a parent task
    await stubTask.createAndNavigate(
      "parent-no-escalate",
      stubScenario(emitText("I am the parent"), idle()),
    );

    // Get workspace info for creating child task
    const workspaces = await client.listWorkspaces({});
    const ws = workspaces.workspaces.find((w) => w.name === stubTask.workspaceName);
    expect(ws).toBeDefined();

    // Get parent task
    const tasks = await client.listTasks({ workspaceId: ws!.id });
    const parent = tasks.tasks.find((t) => t.title === "parent-no-escalate");
    expect(parent).toBeDefined();

    // Create a child task
    const child = await client.createTask({
      workspaceId: ws!.id,
      title: "child-should-not-escalate",
      description: JSON.stringify({ scenario: stubScenario(emitText("child working"), idle()) }),
      parentTaskId: parent!.id,
    });

    // Start the child
    await client.startTask({ taskId: child.id, personaId: "stub", environmentId: "test-local" });

    // Wait a bit for any escalation to potentially fire
    await new Promise((r) => { setTimeout(r, 3_000); });

    // Verify no escalation was created for the child task
    const resp = await client.listEscalations({ workspaceId: "", status: "", limit: 50 });
    const childEscalation = resp.escalations.find((e) => e.title === "child-should-not-escalate");
    expect(childEscalation, "Child tasks should NOT trigger auto-escalation").toBeUndefined();
  });

  test("explicit escalation via RPC", async ({ grackle: { client } }) => {
    // Create an escalation via the RPC directly (simulating what the MCP tool does)
    const esc = await client.createEscalation({
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
    const acked = await client.acknowledgeEscalation({ id: esc.id });
    expect(acked.status).toBe("acknowledged");
    expect(acked.acknowledgedAt).toBeTruthy();

    // List and verify
    const list = await client.listEscalations({ workspaceId: "", status: "acknowledged" });
    const found = list.escalations.find((e) => e.id === esc.id);
    expect(found).toBeDefined();
    expect(found!.status).toBe("acknowledged");
  });
});
