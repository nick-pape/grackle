import { describe, it, expect, vi } from "vitest";
import type { SessionRow } from "@grackle-ai/database";
import {
  createSubagentReconciliationPhase,
  type SubagentReconciliationDeps,
} from "./subagent-reconciliation.js";

vi.mock("@grackle-ai/core", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** Minimal SessionRow factory — only the fields the phase reads need to be real. */
function row(overrides: Partial<SessionRow>): SessionRow {
  return {
    id: "id",
    environmentId: "env",
    runtime: "subagent",
    runtimeSessionId: null,
    prompt: "",
    model: "",
    status: "running",
    logPath: null,
    turns: 0,
    startedAt: "2026-01-01T00:00:00.000Z",
    suspendedAt: null,
    endedAt: null,
    endReason: null,
    error: null,
    taskId: "",
    personaId: "",
    parentSessionId: "parent-1",
    pipeMode: "",
    inputTokens: 0,
    outputTokens: 0,
    costMillicents: 0,
    sigtermSentAt: null,
    ...overrides,
  } as SessionRow;
}

function makeDeps(overrides?: Partial<SubagentReconciliationDeps>): SubagentReconciliationDeps {
  return {
    listRunningSubagentChildren: vi.fn(() => []),
    getSession: vi.fn(() => undefined),
    interruptChildSession: vi.fn(),
    ...overrides,
  };
}

describe("subagent reconciliation phase", () => {
  it("interrupts a running child whose parent is STOPPED", async () => {
    const child = row({ id: "child-1", parentSessionId: "parent-1" });
    const deps = makeDeps({
      listRunningSubagentChildren: vi.fn(() => [child]),
      getSession: vi.fn(() => row({ id: "parent-1", runtime: "claude-code", status: "stopped" })),
    });

    await createSubagentReconciliationPhase(deps).execute();

    expect(deps.interruptChildSession).toHaveBeenCalledWith("child-1");
  });

  it("leaves a child whose parent is still RUNNING", async () => {
    const deps = makeDeps({
      listRunningSubagentChildren: vi.fn(() => [
        row({ id: "child-1", parentSessionId: "parent-1" }),
      ]),
      getSession: vi.fn(() => row({ id: "parent-1", runtime: "claude-code", status: "running" })),
    });

    await createSubagentReconciliationPhase(deps).execute();

    expect(deps.interruptChildSession).not.toHaveBeenCalled();
  });

  it("leaves a child whose parent is IDLE (waiting input)", async () => {
    const deps = makeDeps({
      listRunningSubagentChildren: vi.fn(() => [
        row({ id: "child-1", parentSessionId: "parent-1" }),
      ]),
      getSession: vi.fn(() => row({ id: "parent-1", runtime: "claude-code", status: "idle" })),
    });

    await createSubagentReconciliationPhase(deps).execute();

    expect(deps.interruptChildSession).not.toHaveBeenCalled();
  });

  it("leaves a child whose parent is SUSPENDED (recoverable)", async () => {
    const deps = makeDeps({
      listRunningSubagentChildren: vi.fn(() => [
        row({ id: "child-1", parentSessionId: "parent-1" }),
      ]),
      getSession: vi.fn(() => row({ id: "parent-1", runtime: "claude-code", status: "suspended" })),
    });

    await createSubagentReconciliationPhase(deps).execute();

    expect(deps.interruptChildSession).not.toHaveBeenCalled();
  });

  it("interrupts a child whose parent no longer exists", async () => {
    const deps = makeDeps({
      listRunningSubagentChildren: vi.fn(() => [row({ id: "child-1", parentSessionId: "gone" })]),
      getSession: vi.fn(() => undefined),
    });

    await createSubagentReconciliationPhase(deps).execute();

    expect(deps.interruptChildSession).toHaveBeenCalledWith("child-1");
  });

  it("interrupts a child with no parent reference", async () => {
    const getSession = vi.fn(() => undefined);
    const deps = makeDeps({
      listRunningSubagentChildren: vi.fn(() => [row({ id: "child-1", parentSessionId: "" })]),
      getSession,
    });

    await createSubagentReconciliationPhase(deps).execute();

    expect(deps.interruptChildSession).toHaveBeenCalledWith("child-1");
    // An empty parentSessionId must not even trigger a lookup.
    expect(getSession).not.toHaveBeenCalled();
  });

  it("does nothing when there are no running subagent children", async () => {
    const deps = makeDeps();
    await createSubagentReconciliationPhase(deps).execute();
    expect(deps.interruptChildSession).not.toHaveBeenCalled();
  });

  it("interrupts only the stranded children among a mixed set", async () => {
    const children = [
      row({ id: "stranded-1", parentSessionId: "p-stopped" }),
      row({ id: "alive", parentSessionId: "p-running" }),
      row({ id: "stranded-2", parentSessionId: "p-gone" }),
    ];
    const parents: Record<string, SessionRow | undefined> = {
      "p-stopped": row({ id: "p-stopped", runtime: "claude-code", status: "stopped" }),
      "p-running": row({ id: "p-running", runtime: "claude-code", status: "running" }),
      "p-gone": undefined,
    };
    const deps = makeDeps({
      listRunningSubagentChildren: vi.fn(() => children),
      getSession: vi.fn((id: string) => parents[id]),
    });

    await createSubagentReconciliationPhase(deps).execute();

    expect(deps.interruptChildSession).toHaveBeenCalledTimes(2);
    expect(deps.interruptChildSession).toHaveBeenCalledWith("stranded-1");
    expect(deps.interruptChildSession).toHaveBeenCalledWith("stranded-2");
    expect(deps.interruptChildSession).not.toHaveBeenCalledWith("alive");
  });

  it("continues after an individual interrupt failure", async () => {
    const deps = makeDeps({
      listRunningSubagentChildren: vi.fn(() => [
        row({ id: "child-1", parentSessionId: "p-stopped" }),
        row({ id: "child-2", parentSessionId: "p-stopped" }),
      ]),
      getSession: vi.fn(() => row({ id: "p-stopped", runtime: "claude-code", status: "stopped" })),
      interruptChildSession: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("DB error");
        })
        .mockImplementationOnce(() => {}),
    });

    await createSubagentReconciliationPhase(deps).execute();

    expect(deps.interruptChildSession).toHaveBeenCalledTimes(2);
  });
});
