/**
 * Unit tests for the orchestrator context builder (pure, no database mocks).
 */
import { describe, it, expect } from "vitest";
import type { OrchestratorContextInput } from "./orchestrator-context.js";
import { buildOrchestratorContext } from "./orchestrator-context.js";

/** Helper: builds a minimal valid input with overrides. */
function makeInput(overrides: Partial<OrchestratorContextInput> = {}): OrchestratorContextInput {
  return {
    tasks: [],
    personas: [],
    environments: [],
    findings: [],
    ...overrides,
  };
}

describe("buildOrchestratorContext", () => {
  it("returns workspace metadata when provided", () => {
    const result = buildOrchestratorContext(makeInput({
      workspace: { name: "My Project", description: "A cool project", repoUrl: "https://github.com/test/repo" },
    }));

    expect(result.workspace).toEqual({
      name: "My Project",
      description: "A cool project",
      repoUrl: "https://github.com/test/repo",
    });
  });

  it("returns undefined workspace when not provided", () => {
    const result = buildOrchestratorContext(makeInput());

    expect(result.workspace).toBeUndefined();
  });

  it("maps tasks to TaskTreeNode with resolved persona names", () => {
    const result = buildOrchestratorContext(makeInput({
      personas: [
        { id: "eng", name: "Engineer", description: "Writes code", runtime: "claude-code", model: "" },
      ],
      tasks: [
        { id: "t1", title: "Task 1", status: "working", depth: 0, parentTaskId: "", dependsOn: ["t0"], defaultPersonaId: "eng", branch: "feat-1", canDecompose: true },
      ],
    }));

    expect(result.taskTree).toHaveLength(1);
    expect(result.taskTree[0]).toEqual({
      id: "t1",
      title: "Task 1",
      status: "working",
      depth: 0,
      parentTaskId: "",
      dependsOn: ["t0"],
      personaName: "Engineer",
      branch: "feat-1",
      canDecompose: true,
    });
  });

  it("resolves persona name to empty string when persona not found", () => {
    const result = buildOrchestratorContext(makeInput({
      personas: [],
      tasks: [
        { id: "t1", title: "Task 1", status: "not_started", depth: 0, parentTaskId: "", dependsOn: [], defaultPersonaId: "unknown-persona", branch: "", canDecompose: false },
      ],
    }));

    expect(result.taskTree[0].personaName).toBe("");
  });

  it("returns all personas as PersonaSummary", () => {
    const result = buildOrchestratorContext(makeInput({
      personas: [
        { id: "eng", name: "Engineer", description: "Writes code", runtime: "claude-code", model: "" },
        { id: "rev", name: "Reviewer", description: "Reviews PRs", runtime: "copilot", model: "" },
      ],
    }));

    expect(result.availablePersonas).toEqual([
      { name: "Engineer", description: "Writes code", runtime: "claude-code", model: "" },
      { name: "Reviewer", description: "Reviews PRs", runtime: "copilot", model: "" },
    ]);
  });

  it("returns all environments as EnvironmentSummary", () => {
    const result = buildOrchestratorContext(makeInput({
      environments: [
        { displayName: "Local Dev", adapterType: "local", status: "connected", defaultRuntime: "claude-code" },
        { displayName: "SSH Box", adapterType: "ssh", status: "disconnected", defaultRuntime: "claude-code" },
      ],
    }));

    expect(result.availableEnvironments).toEqual([
      { displayName: "Local Dev", adapterType: "local", status: "connected", defaultRuntime: "claude-code" },
      { displayName: "SSH Box", adapterType: "ssh", status: "disconnected", defaultRuntime: "claude-code" },
    ]);
  });

  it("returns findings context string", () => {
    const result = buildOrchestratorContext(makeInput({
      findings: [
        { category: "decision", title: "Used React", content: "Chose React for the frontend." },
      ],
    }));

    expect(result.findingsContext).toContain("## Workspace Findings");
    expect(result.findingsContext).toContain("[decision] Used React");
    expect(result.findingsContext).toContain("Chose React for the frontend.");
  });

  it("handles empty inputs gracefully", () => {
    const result = buildOrchestratorContext(makeInput());

    expect(result.taskTree).toEqual([]);
    expect(result.availablePersonas).toEqual([]);
    expect(result.availableEnvironments).toEqual([]);
    expect(result.findingsContext).toBe("");
    expect(result.workspace).toBeUndefined();
  });

  it("truncates individual findings content to 500 characters", () => {
    const longContent = "A".repeat(600);
    const result = buildOrchestratorContext(makeInput({
      findings: [
        { category: "bug", title: "Long Finding", content: longContent },
      ],
    }));

    expect(result.findingsContext).toContain("A".repeat(500) + "...");
    expect(result.findingsContext).not.toContain("A".repeat(501));
  });

  it("respects the 8K character budget for findings context", () => {
    // Create 30 findings each ~400 chars — total would exceed 8K
    const findings = Array.from({ length: 30 }, (_, i) => ({
      category: "note",
      title: `Finding ${i}`,
      content: "B".repeat(400),
    }));

    const result = buildOrchestratorContext(makeInput({ findings }));

    expect(result.findingsContext.length).toBeLessThanOrEqual(8500);
    // Should include some but not all findings
    expect(result.findingsContext).toContain("Finding 0");
  });

  it("handles tasks with multiple dependsOn entries", () => {
    const result = buildOrchestratorContext(makeInput({
      tasks: [
        { id: "t3", title: "Final Task", status: "not_started", depth: 1, parentTaskId: "t0", dependsOn: ["t1", "t2"], defaultPersonaId: "", branch: "", canDecompose: false },
      ],
    }));

    expect(result.taskTree[0].dependsOn).toEqual(["t1", "t2"]);
  });

  it("handles tasks with empty dependsOn", () => {
    const result = buildOrchestratorContext(makeInput({
      tasks: [
        { id: "t1", title: "Solo Task", status: "not_started", depth: 0, parentTaskId: "", dependsOn: [], defaultPersonaId: "", branch: "", canDecompose: false },
      ],
    }));

    expect(result.taskTree[0].dependsOn).toEqual([]);
  });
});
