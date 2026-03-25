import { test, expect } from "./fixtures.js";
import {
  getWorkspaceId,
  createTaskDirect,
  navigateToTask,
  stubScenario,
  emitSubtaskCreate,
  emitText,
} from "./helpers.js";

test.describe("Subtask dependency rejection", { tag: ["@task"] }, () => {
  test("rejects subtask with unresolvable depends_on and accepts valid sibling", async ({ stubTask }) => {
    const { page, client, workspaceName } = stubTask;
    const workspaceId = await getWorkspaceId(client, workspaceName);

    // Create a decomposable parent task with a scenario that emits:
    //   1. A valid subtask "Research" with local_id "research"
    //   2. A bad subtask "Implement" that depends on "nonexistent" — should be rejected
    //   3. A valid subtask "Cleanup" with no deps — should succeed
    const scenario = stubScenario(
      emitSubtaskCreate("Research", "Do research", { localId: "research" }),
      emitSubtaskCreate("Implement", "Do implementation", {
        localId: "impl",
        dependsOn: ["nonexistent"],
      }),
      emitSubtaskCreate("Cleanup", "Final cleanup", { localId: "cleanup" }),
      emitText("Done creating subtasks"),
    );

    await createTaskDirect(client, workspaceId, "Decomposable Parent", {
      description: JSON.stringify(scenario),
      environmentId: "test-local",
      canDecompose: true,
    });

    // Navigate to parent task and start it
    await navigateToTask(page, "Decomposable Parent");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Wait for the stub scenario to complete — the "Done creating subtasks" text appears
    await page.getByText("Done creating subtasks").waitFor({ timeout: 15_000 });

    // Query tasks via gRPC — parent should have exactly 2 children (Research + Cleanup).
    // "Implement" should have been rejected due to unresolvable depends_on.
    // Poll briefly in case task creation events are still flushing.
    await expect(async () => {
      const resp = await client.listTasks({ workspaceId });
      const parent = resp.tasks.find((t) => t.title === "Decomposable Parent");
      expect(parent).toBeDefined();

      const childIds = parent!.childTaskIds;
      const childTitles = resp.tasks
        .filter((t) => childIds.includes(t.id))
        .map((t) => t.title)
        .sort();

      expect(childTitles).toEqual(["Cleanup", "Research"]);
    }).toPass({ timeout: 10_000, intervals: [500] });
  });
});
