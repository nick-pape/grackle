import { describe, it, expect } from "vitest";
import { buildTaskSystemContext } from "./system-context.js";

describe("buildTaskSystemContext", () => {
  it("includes task title and description", () => {
    const result = buildTaskSystemContext("My Task", "Do the thing", "");
    expect(result).toContain("## Task: My Task");
    expect(result).toContain("Do the thing");
  });

  it("includes notes when provided", () => {
    const result = buildTaskSystemContext("Task", "desc", "Fix the bug please");
    expect(result).toContain("## Notes");
    expect(result).toContain("Fix the bug please");
  });

  it("omits notes section when notes are empty", () => {
    const result = buildTaskSystemContext("Task", "desc", "");
    expect(result).not.toContain("## Notes");
  });

  it("always includes post_finding and query_findings tools", () => {
    const result = buildTaskSystemContext("Task", "desc", "");
    expect(result).toContain("mcp__grackle__post_finding");
    expect(result).toContain("mcp__grackle__query_findings");
  });

  it("includes create_subtask tool when canDecompose is true", () => {
    const result = buildTaskSystemContext("Task", "desc", "", true);
    expect(result).toContain("mcp__grackle__create_subtask");
    expect(result).toContain("Delegate work to another agent");
  });

  it("omits create_subtask tool when canDecompose is false", () => {
    const result = buildTaskSystemContext("Task", "desc", "", false);
    expect(result).not.toContain("mcp__grackle__create_subtask");
  });

  it("omits create_subtask tool when canDecompose is undefined", () => {
    const result = buildTaskSystemContext("Task", "desc", "");
    expect(result).not.toContain("mcp__grackle__create_subtask");
  });

  it("always includes the completion checklist with all three phases", () => {
    const result = buildTaskSystemContext("Task", "desc", "", true);
    expect(result).toContain("## Completion Checklist");
    expect(result).toContain("### Phase 1: Implement & Test");
    expect(result).toContain("### Phase 2: Create PR");
    expect(result).toContain("### Phase 3: PR Readiness");
    expect(result).toContain("IMPORTANT: The PR is the deliverable");
  });

  it("includes CI and review instructions in Phase 3", () => {
    const result = buildTaskSystemContext("Task", "desc", "");
    expect(result).toContain("Wait for CI");
    expect(result).toContain("Address code review comments");
    expect(result).toContain("resolve the thread");
  });

  it("includes merge conflict check in Phase 3", () => {
    const result = buildTaskSystemContext("Task", "desc", "");
    expect(result).toContain("Check for merge conflicts");
    expect(result).toContain("NEVER rebase");
  });
});
