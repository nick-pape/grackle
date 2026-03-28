import { describe, it, expect } from "vitest";
import { SystemPromptBuilder, buildTaskPrompt, type SystemPromptOptions, type TaskTreeNode } from "./system-prompt-builder.js";

describe("SystemPromptBuilder", () => {
  it("includes completion contract, signals, findings, and MCP note for task sessions", () => {
    const result = new SystemPromptBuilder({
      task: { title: "My Task", description: "Do the thing", notes: "" },
    }).build();

    expect(result).toContain("## Completion");
    expect(result).toContain("## Signals");
    expect(result).toContain("[SIGCHLD]");
    expect(result).toContain("[SIGTERM]");
    expect(result).toContain("ipc_close");
    expect(result).toContain("## Findings");
    expect(result).toContain("finding_post");
    expect(result).toContain("grackle");
  });

  it("leaf task completion contract tells agent to stop working, not self-complete", () => {
    const result = new SystemPromptBuilder({
      task: { title: "My Task", description: "Do the thing", notes: "" },
    }).build();

    // Leaf tasks should NOT be told to call task_complete on themselves
    expect(result).not.toContain("use `task_complete` to signal completion");
    // They should be told to stop working and let the parent complete them
    expect(result).toContain("stop working");
    expect(result).toContain("Do NOT call `task_complete` on your own task");
  });

  it("does not include task title or description in system prompt", () => {
    const result = new SystemPromptBuilder({
      task: { title: "My Task", description: "Do the thing", notes: "" },
    }).build();

    expect(result).not.toContain("## Task:");
    expect(result).not.toContain("## Notes");
  });

  it("includes subtask guidance when canDecompose is true", () => {
    const result = new SystemPromptBuilder({
      task: { title: "My Task", description: "Do the thing", notes: "" },
      canDecompose: true,
    }).build();

    expect(result).toContain("## Subtasks");
    expect(result).toContain("task_create");
    expect(result).toContain("task_list");
    expect(result).not.toContain("Subtask creation is disabled");
  });

  it("says subtasks are disabled when canDecompose is false", () => {
    const result = new SystemPromptBuilder({
      task: { title: "My Task", description: "Do the thing", notes: "" },
      canDecompose: false,
    }).build();

    expect(result).toContain("## Subtasks");
    expect(result).toContain("Subtask creation is disabled");
    expect(result).not.toContain("task_create");
  });

  it("ad-hoc session (no task) includes persona prompt, IPC section, and MCP note", () => {
    const result = new SystemPromptBuilder({
      personaPrompt: "You are a helpful assistant.",
    }).build();

    expect(result).toContain("You are a helpful assistant.");
    expect(result).toContain("## IPC File Descriptors");
    expect(result).toContain("grackle");
    expect(result).not.toContain("## Completion");
    expect(result).not.toContain("## Signals");
    expect(result).not.toContain("## Findings");
    expect(result).not.toContain("## Subtasks");
  });

  it("ad-hoc session with no persona has IPC fd section and MCP note", () => {
    const result = new SystemPromptBuilder({}).build();

    expect(result).toContain("## IPC File Descriptors");
    expect(result).toContain("ipc_list_fds");
    expect(result).toContain("ipc_close");
    expect(result).toContain("You have tools on your `grackle` MCP server.");
  });

  it("prepends persona prompt when provided", () => {
    const result = new SystemPromptBuilder({
      task: { title: "My Task", description: "Do the thing", notes: "" },
      personaPrompt: "Be concise and direct.",
    }).build();

    expect(result.indexOf("Be concise and direct.")).toBeLessThan(result.indexOf("## Completion"));
  });

  it("does not add extra whitespace when persona prompt is empty", () => {
    const result = new SystemPromptBuilder({
      task: { title: "My Task", description: "Do the thing", notes: "" },
      personaPrompt: "",
    }).build();

    expect(result).not.toMatch(/^\s/);
  });

  it("uses short tool names without mcp__grackle__ prefix", () => {
    const result = new SystemPromptBuilder({
      task: { title: "My Task", description: "Do the thing", notes: "" },
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

  it("omits notes when notes are empty", () => {
    expect(buildTaskPrompt("My Task", "Do the thing", "")).toBe("My Task\n\nDo the thing");
  });
});

// ─── Orchestrator Template Tests ─────────────────────────────

/** Helper: build a full orchestrator options object. */
function orchestratorOptions(overrides?: Partial<SystemPromptOptions>): SystemPromptOptions {
  const taskTree: TaskTreeNode[] = [
    { id: "root", title: "Root Task", status: "working", depth: 0, parentTaskId: "", dependsOn: [], personaName: "Orchestrator", branch: "", canDecompose: true },
    { id: "child-a", title: "Implement feature", status: "not_started", depth: 1, parentTaskId: "root", dependsOn: [], personaName: "Engineer", branch: "feat-a", canDecompose: false },
    { id: "child-b", title: "Write tests", status: "not_started", depth: 1, parentTaskId: "root", dependsOn: ["child-a"], personaName: "Engineer", branch: "feat-b", canDecompose: false },
  ];

  return {
    task: { title: "Orchestrate project", description: "Coordinate the implementation", notes: "" },
    taskId: "root",
    canDecompose: true,
    personaPrompt: "You are a senior architect.",
    taskDepth: 0,
    workspace: { name: "my-project", description: "A test project", repoUrl: "https://github.com/test/repo" },
    taskTree,
    availablePersonas: [
      { name: "Engineer", description: "Writes code", runtime: "claude-code", model: "sonnet" },
      { name: "Reviewer", description: "Reviews PRs", runtime: "copilot", model: "" },
    ],
    availableEnvironments: [
      { displayName: "Local", adapterType: "local", status: "connected", defaultRuntime: "claude-code" },
      { displayName: "Dev SSH", adapterType: "ssh", status: "disconnected", defaultRuntime: "codex" },
    ],
    findingsContext: "## Workspace Findings (shared knowledge from other agents)\n\n### [architecture] Use event sourcing\nDecided to use event sourcing for audit trail.\n",
    triggerMode: "fresh",
    ...overrides,
  };
}

describe("SystemPromptBuilder (orchestrator)", () => {
  it("includes all orchestrator section headers in fresh mode", () => {
    const result = new SystemPromptBuilder(orchestratorOptions()).build();

    expect(result).toContain("## Your Task: Orchestrate project");
    expect(result).toContain("orchestrator agent");
    expect(result).toContain("## Workspace Context");
    expect(result).toContain("## Task Tree");
    expect(result).toContain("## Available Personas");
    expect(result).toContain("## Available Environments");
    expect(result).toContain("## Workspace Findings");
    expect(result).toContain("## Trigger Context");
    expect(result).toContain("## Decomposition Guidelines");
    expect(result).toContain("## Completion");
    expect(result).toContain("## Signals");
    expect(result).toContain("grackle");
  });

  it("does NOT include leaf sections", () => {
    const result = new SystemPromptBuilder(orchestratorOptions()).build();

    expect(result).not.toContain("## Task: Orchestrate project"); // leaf uses "## Task:", orchestrator uses "## Your Task:"
    expect(result).not.toContain("Subtask creation is disabled");
    expect(result).not.toContain("## Subtasks");
    expect(result).not.toContain("Do not go idle without signaling");
  });

  it("prepends persona prompt before orchestrator sections", () => {
    const result = new SystemPromptBuilder(orchestratorOptions()).build();

    expect(result.indexOf("You are a senior architect.")).toBeLessThan(
      result.indexOf("## Your Task:"),
    );
  });

  it("renders task tree with hierarchy, statuses, and personas", () => {
    const result = new SystemPromptBuilder(orchestratorOptions()).build();

    expect(result).toContain("- [working] Root Task (persona: Orchestrator) <-- YOU");
    expect(result).toContain("  - [not_started] Implement feature (persona: Engineer) [branch: feat-a]");
    expect(result).toContain("  - [not_started] Write tests (persona: Engineer) [depends on: child-a] [branch: feat-b]");
  });

  it("renders task tree status summary", () => {
    const result = new SystemPromptBuilder(orchestratorOptions()).build();

    expect(result).toContain("1 working");
    expect(result).toContain("2 not_started");
  });

  it("omits task tree section when taskTree is empty", () => {
    const result = new SystemPromptBuilder(orchestratorOptions({ taskTree: [] })).build();

    expect(result).not.toContain("## Task Tree");
  });

  it("marks current task with <-- YOU marker", () => {
    const result = new SystemPromptBuilder(orchestratorOptions({ taskId: "child-a" })).build();

    expect(result).toContain("Implement feature (persona: Engineer) [branch: feat-a] <-- YOU");
    expect(result).not.toContain("Root Task (persona: Orchestrator) <-- YOU");
  });

  it("renders workspace context with name, description, and repo URL", () => {
    const result = new SystemPromptBuilder(orchestratorOptions()).build();

    expect(result).toContain("**Name**: my-project");
    expect(result).toContain("**Description**: A test project");
    expect(result).toContain("**Repository**: https://github.com/test/repo");
  });

  it("omits workspace section when workspace is undefined", () => {
    const result = new SystemPromptBuilder(orchestratorOptions({ workspace: undefined })).build();

    expect(result).not.toContain("## Workspace Context");
  });

  it("renders available personas table", () => {
    const result = new SystemPromptBuilder(orchestratorOptions()).build();

    expect(result).toContain("| Engineer | Writes code | claude-code | sonnet |");
    expect(result).toContain("| Reviewer | Reviews PRs | copilot | — |");
  });

  it("omits personas section when list is empty", () => {
    const result = new SystemPromptBuilder(orchestratorOptions({ availablePersonas: [] })).build();

    expect(result).not.toContain("## Available Personas");
  });

  it("renders available environments table", () => {
    const result = new SystemPromptBuilder(orchestratorOptions()).build();

    expect(result).toContain("| Local | local | connected | claude-code |");
    expect(result).toContain("| Dev SSH | ssh | disconnected | codex |");
  });

  it("omits environments section when list is empty", () => {
    const result = new SystemPromptBuilder(orchestratorOptions({ availableEnvironments: [] })).build();

    expect(result).not.toContain("## Available Environments");
  });

  it("includes findings context when non-empty", () => {
    const result = new SystemPromptBuilder(orchestratorOptions()).build();

    expect(result).toContain("Use event sourcing");
  });

  it("omits findings section when findingsContext is empty", () => {
    const result = new SystemPromptBuilder(orchestratorOptions({ findingsContext: "" })).build();

    expect(result).not.toContain("## Workspace Findings");
  });

  it("shows fresh trigger context", () => {
    const result = new SystemPromptBuilder(orchestratorOptions()).build();

    expect(result).toContain("invoked for the first time");
  });

  it("shows resume trigger context", () => {
    const result = new SystemPromptBuilder(orchestratorOptions({ triggerMode: "resume" })).build();

    expect(result).toContain("re-invoked");
    expect(result).not.toContain("first time");
  });

  it("includes decomposition guidelines with key phrases", () => {
    const result = new SystemPromptBuilder(orchestratorOptions()).build();

    expect(result).toContain("context-boundary");
    expect(result).toContain("self-contained");
    expect(result).toContain("3-7");
  });

  it("includes orchestrator completion contract", () => {
    const result = new SystemPromptBuilder(orchestratorOptions()).build();

    expect(result).toContain("all subtasks are complete");
    expect(result).toContain("task_complete");
  });

  it("includes orchestrator tools documentation", () => {
    const result = new SystemPromptBuilder(orchestratorOptions()).build();

    expect(result).toContain("## Orchestrator Tools");
    expect(result).toContain("task_create");
    expect(result).toContain("task_list");
    expect(result).toContain("task_start");
    expect(result).toContain("finding_post");
    expect(result).toContain("finding_list");
    expect(result).toContain("session_attach");
    expect(result).toContain("logs_get");
  });

  it("uses leaf template when canDecompose is true but depth > 1", () => {
    const result = new SystemPromptBuilder(orchestratorOptions({ taskDepth: 2 })).build();

    // Should get leaf template, not orchestrator
    expect(result).not.toContain("## Task: Orchestrate project");
    expect(result).not.toContain("## Your Task:");
    expect(result).not.toContain("orchestrator agent");
  });

  it("uses leaf template when canDecompose is false even at depth 0", () => {
    const result = new SystemPromptBuilder(orchestratorOptions({ canDecompose: false, taskDepth: 0 })).build();

    expect(result).not.toContain("## Task: Orchestrate project");
    expect(result).toContain("Subtask creation is disabled");
    expect(result).not.toContain("## Your Task:");
  });

  it("uses leaf template when canDecompose is true but taskTree is not provided", () => {
    const result = new SystemPromptBuilder({
      task: { title: "Task", description: "desc", notes: "" },
      canDecompose: true,
      // No taskDepth or taskTree → leaf path
    }).build();

    expect(result).not.toContain("## Task: Task");
    expect(result).toContain("## Subtasks");
    expect(result).not.toContain("## Your Task:");
  });

  it("produces deterministic output", () => {
    const opts = orchestratorOptions();
    const a = new SystemPromptBuilder(opts).build();
    const b = new SystemPromptBuilder(opts).build();

    expect(a).toBe(b);
  });

  it("includes notes in orchestrator template when provided", () => {
    const result = new SystemPromptBuilder(
      orchestratorOptions({ task: { title: "Task", description: "desc", notes: "Retry after auth fix" } }),
    ).build();

    expect(result).toContain("### Notes");
    expect(result).toContain("Retry after auth fix");
  });

  it("includes workpad section when workpad is non-empty (leaf)", () => {
    const workpad = JSON.stringify({ status: "in progress", summary: "Opened PR #42" });
    const result = new SystemPromptBuilder({
      task: { title: "Task", description: "desc", notes: "" },
      workpad,
    }).build();

    expect(result).toContain("## Previous Session Workpad");
    expect(result).toContain("Opened PR #42");
  });

  it("omits workpad section when workpad is empty", () => {
    const result = new SystemPromptBuilder({
      task: { title: "Task", description: "desc", notes: "" },
      workpad: "",
    }).build();

    expect(result).not.toContain("## Previous Session Workpad");
  });

  it("includes workpad section in orchestrator prompt when non-empty", () => {
    const workpad = JSON.stringify({ status: "blocked", summary: "Waiting on auth" });
    const result = new SystemPromptBuilder(
      orchestratorOptions({ workpad }),
    ).build();

    expect(result).toContain("## Previous Session Workpad");
    expect(result).toContain("Waiting on auth");
  });

  it("includes workpad write instructions for leaf tasks", () => {
    const result = new SystemPromptBuilder({
      task: { title: "Task", description: "desc", notes: "" },
    }).build();

    expect(result).toContain("## Workpad");
    expect(result).toContain("workpad_write");
  });
});
