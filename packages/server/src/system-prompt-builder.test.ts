import { describe, it, expect } from "vitest";
import { SystemPromptBuilder, buildTaskPrompt } from "./system-prompt-builder.js";

describe("SystemPromptBuilder", () => {
  it("includes completion contract, signals, findings, and MCP note for task sessions", () => {
    const result = new SystemPromptBuilder({
      isTaskSession: true,
    }).build();

    expect(result).toContain("## Completion");
    expect(result).toContain("task_complete");
    expect(result).toContain("## Signals");
    expect(result).toContain("[SIGCHLD]");
    expect(result).toContain("## Findings");
    expect(result).toContain("finding_post");
    expect(result).toContain("grackle");
  });

  it("does not include task title or description in system prompt", () => {
    const result = new SystemPromptBuilder({
      isTaskSession: true,
    }).build();

    expect(result).not.toContain("## Task:");
    expect(result).not.toContain("## Notes");
  });

  it("includes subtask guidance when canDecompose is true", () => {
    const result = new SystemPromptBuilder({
      isTaskSession: true,
      canDecompose: true,
    }).build();

    expect(result).toContain("## Subtasks");
    expect(result).toContain("task_create");
    expect(result).toContain("task_list");
    expect(result).not.toContain("Subtask creation is disabled");
  });

  it("says subtasks are disabled when canDecompose is false", () => {
    const result = new SystemPromptBuilder({
      isTaskSession: true,
      canDecompose: false,
    }).build();

    expect(result).toContain("## Subtasks");
    expect(result).toContain("Subtask creation is disabled");
    expect(result).not.toContain("task_create");
  });

  it("ad-hoc session (no task) only includes MCP note and persona prompt", () => {
    const result = new SystemPromptBuilder({
      personaPrompt: "You are a helpful assistant.",
    }).build();

    expect(result).toContain("You are a helpful assistant.");
    expect(result).toContain("grackle");
    expect(result).not.toContain("## Completion");
    expect(result).not.toContain("## Signals");
    expect(result).not.toContain("## Findings");
    expect(result).not.toContain("## Subtasks");
  });

  it("ad-hoc session with no persona just has MCP note", () => {
    const result = new SystemPromptBuilder({}).build();

    expect(result).toBe("You have tools on your `grackle` MCP server.");
  });

  it("prepends persona prompt when provided", () => {
    const result = new SystemPromptBuilder({
      isTaskSession: true,
      personaPrompt: "Be concise and direct.",
    }).build();

    expect(result.indexOf("Be concise and direct.")).toBeLessThan(result.indexOf("## Completion"));
  });

  it("does not add extra whitespace when persona prompt is empty", () => {
    const result = new SystemPromptBuilder({
      isTaskSession: true,
      personaPrompt: "",
    }).build();

    expect(result).not.toMatch(/^\s/);
  });

  it("uses short tool names without mcp__grackle__ prefix", () => {
    const result = new SystemPromptBuilder({
      isTaskSession: true,
      canDecompose: true,
    }).build();

    expect(result).not.toContain("mcp__grackle__");
    expect(result).toContain("task_complete");
    expect(result).toContain("task_create");
    expect(result).toContain("finding_post");
    expect(result).toContain("finding_list");
  });
});

describe("buildTaskPrompt", () => {
  it("returns title + description separated by blank line", () => {
    expect(buildTaskPrompt("My Task", "Do the thing")).toBe("My Task\n\nDo the thing");
  });

  it("returns just the title when description is empty", () => {
    expect(buildTaskPrompt("My Task", "")).toBe("My Task");
  });

  it("includes notes section when notes are provided", () => {
    expect(buildTaskPrompt("My Task", "Do the thing", "Fix the bug")).toBe(
      "My Task\n\nDo the thing\n\n## Notes\nFix the bug",
    );
  });

  it("omits notes when not provided", () => {
    expect(buildTaskPrompt("My Task", "Do the thing", "")).toBe("My Task\n\nDo the thing");
  });
});
