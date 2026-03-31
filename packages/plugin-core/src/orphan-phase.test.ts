import { describe, it, expect, vi } from "vitest";
import { createOrphanPhase, type OrphanPhaseDeps } from "./orphan-phase.js";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeDeps(overrides?: Partial<OrphanPhaseDeps>): OrphanPhaseDeps {
  return {
    listAllTasks: vi.fn(() => []),
    reparentTask: vi.fn(),
    emit: vi.fn(),
    ...overrides,
  };
}

describe("orphan reconciliation phase", () => {
  it("finds and reparents orphaned tasks with terminal parents", async () => {
    const deps = makeDeps({
      listAllTasks: vi.fn(() => [
        { id: "gp", parentTaskId: "", status: "working", depth: 0, workspaceId: "ws" },
        { id: "p", parentTaskId: "gp", status: "complete", depth: 1, workspaceId: "ws" },
        { id: "c", parentTaskId: "p", status: "not_started", depth: 2, workspaceId: "ws" },
      ] as never),
    });

    const phase = createOrphanPhase(deps);
    await phase.execute();

    expect(deps.reparentTask).toHaveBeenCalledWith("c", "gp");
  });

  it("skips tasks whose parent is non-terminal", async () => {
    const deps = makeDeps({
      listAllTasks: vi.fn(() => [
        { id: "p", parentTaskId: "", status: "working", depth: 0, workspaceId: "ws" },
        { id: "c", parentTaskId: "p", status: "not_started", depth: 1, workspaceId: "ws" },
      ] as never),
    });

    const phase = createOrphanPhase(deps);
    await phase.execute();

    expect(deps.reparentTask).not.toHaveBeenCalled();
  });

  it("skips tasks that are themselves terminal", async () => {
    const deps = makeDeps({
      listAllTasks: vi.fn(() => [
        { id: "p", parentTaskId: "", status: "complete", depth: 0, workspaceId: "ws" },
        { id: "c", parentTaskId: "p", status: "complete", depth: 1, workspaceId: "ws" },
      ] as never),
    });

    const phase = createOrphanPhase(deps);
    await phase.execute();

    expect(deps.reparentTask).not.toHaveBeenCalled();
  });

  it("skips root-level tasks (no parent)", async () => {
    const deps = makeDeps({
      listAllTasks: vi.fn(() => [
        { id: "root", parentTaskId: "", status: "not_started", depth: 0, workspaceId: "ws" },
      ] as never),
    });

    const phase = createOrphanPhase(deps);
    await phase.execute();

    expect(deps.reparentTask).not.toHaveBeenCalled();
  });

  it("reparents to ROOT_TASK_ID when no grandparent exists", async () => {
    const deps = makeDeps({
      listAllTasks: vi.fn(() => [
        { id: "p", parentTaskId: "", status: "complete", depth: 0, workspaceId: "ws" },
        { id: "c", parentTaskId: "p", status: "working", depth: 1, workspaceId: "ws" },
      ] as never),
    });

    const phase = createOrphanPhase(deps);
    await phase.execute();

    expect(deps.reparentTask).toHaveBeenCalledWith("c", "system");
  });

  it("emits task.reparented and task.updated events", async () => {
    const deps = makeDeps({
      listAllTasks: vi.fn(() => [
        { id: "gp", parentTaskId: "", status: "working", depth: 0, workspaceId: "ws" },
        { id: "p", parentTaskId: "gp", status: "failed", depth: 1, workspaceId: "ws" },
        { id: "c", parentTaskId: "p", status: "not_started", depth: 2, workspaceId: "ws" },
      ] as never),
    });

    const phase = createOrphanPhase(deps);
    await phase.execute();

    expect(deps.emit).toHaveBeenCalledWith("task.reparented", expect.objectContaining({
      taskId: "c",
      oldParentTaskId: "p",
      newParentTaskId: "gp",
    }));
    expect(deps.emit).toHaveBeenCalledWith("task.updated", expect.objectContaining({
      taskId: "c",
    }));
  });

  it("handles empty task list without error", async () => {
    const deps = makeDeps();
    const phase = createOrphanPhase(deps);
    await phase.execute();

    expect(deps.reparentTask).not.toHaveBeenCalled();
  });

  it("continues after individual reparent failures", async () => {
    const deps = makeDeps({
      listAllTasks: vi.fn(() => [
        { id: "p", parentTaskId: "", status: "complete", depth: 0, workspaceId: "ws" },
        { id: "c1", parentTaskId: "p", status: "working", depth: 1, workspaceId: "ws" },
        { id: "c2", parentTaskId: "p", status: "working", depth: 1, workspaceId: "ws" },
      ] as never),
      reparentTask: vi.fn()
        .mockImplementationOnce(() => { throw new Error("DB error"); })
        .mockImplementationOnce(() => {}),
    });

    const phase = createOrphanPhase(deps);
    await phase.execute();

    expect(deps.reparentTask).toHaveBeenCalledTimes(2);
  });

  it("reparents multiple orphans from same parent", async () => {
    const deps = makeDeps({
      listAllTasks: vi.fn(() => [
        { id: "gp", parentTaskId: "", status: "working", depth: 0, workspaceId: "ws" },
        { id: "p", parentTaskId: "gp", status: "complete", depth: 1, workspaceId: "ws" },
        { id: "c1", parentTaskId: "p", status: "not_started", depth: 2, workspaceId: "ws" },
        { id: "c2", parentTaskId: "p", status: "working", depth: 2, workspaceId: "ws" },
      ] as never),
    });

    const phase = createOrphanPhase(deps);
    await phase.execute();

    expect(deps.reparentTask).toHaveBeenCalledWith("c1", "gp");
    expect(deps.reparentTask).toHaveBeenCalledWith("c2", "gp");
  });
});
