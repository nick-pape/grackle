/**
 * Builds system prompts for agent sessions, assembling sections
 * dynamically based on the session type (task vs ad-hoc).
 *
 * Orchestrator tasks (canDecompose + depth <= 1) receive rich project
 * context (task tree, persona roster, environments, findings).
 * Leaf tasks receive the existing completion-contract template.
 * Task title and description are NOT included in the system prompt — they
 * belong in the user prompt (see {@link buildTaskPrompt}).
 */

/** Build the user-facing prompt from task title, description, and optional notes. */
export function buildTaskPrompt(title: string, description: string, notes?: string): string {
  const parts = [title];
  if (description) {
    parts.push(description);
  }
  if (notes) {
    parts.push(`## Notes\n${notes}`);
  }
  return parts.join("\n\n");
}

// ─── Orchestrator Data Types ─────────────────────────────────

/** Lightweight task node for rendering the task tree in orchestrator prompts. */
export interface TaskTreeNode {
  /** Task ID. */
  id: string;
  /** Task title. */
  title: string;
  /** Current lifecycle status (not_started, working, paused, complete, failed). */
  status: string;
  /** Nesting depth in the hierarchy (0 = root). */
  depth: number;
  /** Parent task ID (empty string for root-level tasks). */
  parentTaskId: string;
  /** IDs of tasks this task depends on. */
  dependsOn: string[];
  /** Resolved persona display name (empty if none assigned). */
  personaName: string;
  /** Git branch name (empty if none). */
  branch: string;
  /** Whether this task can create subtasks. */
  canDecompose: boolean;
}

/** Persona summary for the available-personas prompt section. */
export interface PersonaSummary {
  /** Display name. */
  name: string;
  /** Short description. */
  description: string;
  /** Runtime backend (claude-code, copilot, codex, etc.). */
  runtime: string;
  /** Default model (e.g. "opus", "sonnet"). */
  model: string;
}

/** Environment summary for the available-environments prompt section. */
export interface EnvironmentSummary {
  /** Human-readable name. */
  displayName: string;
  /** Adapter backend (local, ssh, codespace, docker). */
  adapterType: string;
  /** Connection status (connected, disconnected, etc.). */
  status: string;
  /** Default runtime for this environment. */
  defaultRuntime: string;
}

// ─── Options Interface ───────────────────────────────────────

/** Options for building a system prompt. */
export interface SystemPromptOptions {
  /** Task metadata. When absent, this is an ad-hoc session. */
  task?: { title: string; description: string; notes: string };
  /** ID of the current task (used to mark it in the task tree). */
  taskId?: string;
  /** Whether the agent is allowed to create subtasks. */
  canDecompose?: boolean;
  /** Persona behavioral instructions (prepended when non-empty). */
  personaPrompt?: string;

  // ── Orchestrator-specific fields (all optional) ──

  /** Task depth in the hierarchy (0 = root, 1 = first child, etc.). */
  taskDepth?: number;
  /** Workspace metadata for the orchestrator context section. */
  workspace?: { name: string; description: string; repoUrl: string };
  /** All tasks in the workspace, for rendering the task tree. */
  taskTree?: TaskTreeNode[];
  /** Available personas for the orchestrator to assign. */
  availablePersonas?: PersonaSummary[];
  /** Available environments for the orchestrator to route work to. */
  availableEnvironments?: EnvironmentSummary[];
  /** Pre-built findings context string (from buildFindingsContext). */
  findingsContext?: string;
  /** Invocation mode: fresh (first time) or resume (re-invoked after child completion). */
  triggerMode?: "fresh" | "resume";
  /** Workpad JSON from a previous session on this task (included on retry/resume). */
  workpad?: string;
}

// ─── Builder ─────────────────────────────────────────────────

/**
 * Assembles a system prompt from discrete sections based on session type.
 *
 * Orchestrator tasks get project state, task tree, persona roster, and
 * decomposition guidelines. Leaf tasks get the existing completion contract.
 * Ad-hoc sessions get only the MCP note and persona prompt.
 * Task title and description are NOT included here — they belong in the user prompt
 * (see {@link buildTaskPrompt}).
 */
export class SystemPromptBuilder {
  private readonly options: SystemPromptOptions;

  public constructor(options: SystemPromptOptions) {
    this.options = options;
  }

  /** Build the complete system prompt string. */
  public build(): string {
    const sections: string[] = [];

    // Persona prompt (always first when present)
    if (this.options.personaPrompt) {
      sections.push(this.options.personaPrompt);
    }

    if (this.options.task) {
      if (this.isOrchestrator()) {
        sections.push(this.buildOrchestratorTaskContext());
        sections.push(this.buildWorkspaceContext());
        sections.push(this.buildTaskTree());
        sections.push(this.buildAvailablePersonas());
        sections.push(this.buildAvailableEnvironments());
        sections.push(this.buildOrchestratorFindingsSection());
        sections.push(this.buildTriggerContext());
        sections.push(this.buildDecompositionGuidelines());
        sections.push(this.buildOrchestratorTools());
        sections.push(this.buildWorkpadSection());
        sections.push(this.buildWorkpadWriteSection());
        sections.push(this.buildOrchestratorCompletionContract());
        sections.push(this.buildSignalSection());
      } else {
        // Leaf task: title/description go in the user prompt (buildTaskPrompt), not here.
        sections.push(this.buildWorkpadSection());
        sections.push(this.buildCompletionContract());
        sections.push(this.buildWorkpadWriteSection());
        sections.push(this.buildSubtaskSection());
        sections.push(this.buildSignalSection());
        sections.push(this.buildFindingsSection());
      }
    }

    // IPC fd cleanup instructions (always included — harmless if agent doesn't use IPC)
    sections.push(this.buildIpcFdSection());

    // MCP note (always included)
    sections.push(this.buildMcpNote());

    return sections.filter(Boolean).join("\n\n");
  }

  // ─── Orchestrator Detection ──────────────────────────────

  /**
   * Determine whether this is an orchestrator task.
   * Requires canDecompose, shallow depth, AND orchestrator data fields to be
   * present. This ensures existing callers that pass canDecompose without
   * the new fields still get the leaf template.
   */
  private isOrchestrator(): boolean {
    return this.options.canDecompose === true
      && this.options.taskDepth !== undefined
      && this.options.taskDepth <= 1
      && this.options.taskTree !== undefined;
  }

  // ─── Orchestrator Sections ───────────────────────────────

  /** Orchestrator task context with role framing. */
  private buildOrchestratorTaskContext(): string {
    const { title, description, notes } = this.options.task!;
    const parts = [
      `## Your Task: ${title}`,
      `You are an **orchestrator agent** responsible for decomposing and coordinating work. You do not write code directly — you break work into subtasks, assign personas, manage dependencies, and monitor progress.`,
    ];
    if (description) {
      parts.push(description);
    }
    if (notes) {
      parts.push(`### Notes (from previous attempt or user feedback)\n${notes}`);
    }
    return parts.join("\n\n");
  }

  /** Workspace metadata section. */
  private buildWorkspaceContext(): string {
    const ws = this.options.workspace;
    if (!ws) {
      return "";
    }
    const lines = [`## Workspace Context`];
    lines.push(`- **Name**: ${ws.name}`);
    if (ws.description) {
      lines.push(`- **Description**: ${ws.description}`);
    }
    if (ws.repoUrl) {
      lines.push(`- **Repository**: ${ws.repoUrl}`);
    }
    return lines.join("\n");
  }

  /** Hierarchical task tree with statuses, personas, and dependencies. */
  private buildTaskTree(): string {
    const nodes = this.options.taskTree;
    if (!nodes || nodes.length === 0) {
      return "";
    }

    // Build parent → children map
    const childMap = new Map<string, TaskTreeNode[]>();
    for (const node of nodes) {
      const key = node.parentTaskId || "";
      const children = childMap.get(key);
      if (children) {
        children.push(node);
      } else {
        childMap.set(key, [node]);
      }
    }

    // Status summary
    const counts = new Map<string, number>();
    for (const node of nodes) {
      counts.set(node.status, (counts.get(node.status) || 0) + 1);
    }
    const summary = [...counts.entries()]
      .map(([status, count]) => `${count} ${status}`)
      .join(", ");

    // Recursive render
    const lines: string[] = [];
    const renderNode = (node: TaskTreeNode, indent: number): void => {
      const pad = "  ".repeat(indent);
      const persona = node.personaName ? ` (persona: ${node.personaName})` : "";
      const deps = node.dependsOn.length > 0
        ? ` [depends on: ${node.dependsOn.join(", ")}]`
        : "";
      const branch = node.branch ? ` [branch: ${node.branch}]` : "";
      const marker = node.id === this.options.taskId ? " <-- YOU" : "";
      lines.push(`${pad}- [${node.status}] ${node.title}${persona}${deps}${branch}${marker}`);

      const children = childMap.get(node.id);
      if (children) {
        for (const child of children) {
          renderNode(child, indent + 1);
        }
      }
    };

    // Start from root nodes
    const roots = childMap.get("") || [];
    for (const root of roots) {
      renderNode(root, 0);
    }

    return `## Task Tree\n\nStatus: ${summary}\n\n${lines.join("\n")}`;
  }

  /** Available personas table. */
  private buildAvailablePersonas(): string {
    const personas = this.options.availablePersonas;
    if (!personas || personas.length === 0) {
      return "";
    }
    const rows = personas.map(
      (p) => `| ${p.name} | ${p.description || "—"} | ${p.runtime || "—"} | ${p.model || "—"} |`,
    );
    return [
      `## Available Personas`,
      ``,
      `| Name | Description | Runtime | Model |`,
      `|------|-------------|---------|-------|`,
      ...rows,
    ].join("\n");
  }

  /** Available environments table. */
  private buildAvailableEnvironments(): string {
    const envs = this.options.availableEnvironments;
    if (!envs || envs.length === 0) {
      return "";
    }
    const rows = envs.map(
      (e) => `| ${e.displayName} | ${e.adapterType} | ${e.status} | ${e.defaultRuntime || "—"} |`,
    );
    return [
      `## Available Environments`,
      ``,
      `| Name | Adapter | Status | Runtime |`,
      `|------|---------|--------|---------|`,
      ...rows,
    ].join("\n");
  }

  /** Orchestrator findings section with actual findings data. */
  private buildOrchestratorFindingsSection(): string {
    if (!this.options.findingsContext) {
      return "";
    }
    return this.options.findingsContext;
  }

  /** Trigger context describing why this invocation happened. */
  private buildTriggerContext(): string {
    if (this.options.triggerMode === "resume") {
      return [
        `## Trigger Context`,
        `You are being re-invoked after one or more child tasks completed. Review the task tree above for current statuses and decide what to do next.`,
      ].join("\n");
    }
    return [
      `## Trigger Context`,
      `You are being invoked for the first time to orchestrate this workspace. Assess the current state, then decompose your task into subtasks.`,
    ].join("\n");
  }

  /** Decomposition heuristics and guardrails. */
  private buildDecompositionGuidelines(): string {
    return [
      `## Decomposition Guidelines`,
      ``,
      `- Estimate task complexity before decomposing. Do not decompose simple tasks (under ~100 lines of code or touching fewer than 3 files).`,
      `- Favor context-boundary decomposition over role-boundary decomposition: the agent implementing a feature should also write its tests.`,
      `- Consider coordination cost vs. parallel benefit. Decomposition multiplies token usage by 3-10x.`,
      `- Keep the number of direct subtasks reasonable (aim for 3-7 per parent).`,
      `- Each subtask description must be self-contained — the child agent has no context beyond what you provide in the description.`,
      `- Set dependencies between subtasks when ordering matters. Independent subtasks can run in parallel.`,
      `- Grant decomposition rights (\`canDecompose: true\`) only to subtasks that genuinely need to coordinate further work.`,
    ].join("\n");
  }

  /** Orchestrator-specific MCP tool documentation. */
  private buildOrchestratorTools(): string {
    return [
      `## Orchestrator Tools`,
      ``,
      `Use these tools on your \`grackle\` MCP server to coordinate work:`,
      `- \`task_create\` — Create a subtask with title, description, dependencies, persona, and decomposition rights.`,
      `- \`task_list\` — List all tasks in the workspace with their current statuses.`,
      `- \`task_show\` — Show details of a specific task including its sessions and output.`,
      `- \`task_start\` — Start a task (begins agent execution on the assigned environment).`,
      `- \`task_complete\` — Signal that your task is complete.`,
      `- \`finding_post\` — Share a discovery (architecture decisions, patterns, bugs) with other agents.`,
      `- \`finding_list\` — List recent findings from all agents in this workspace.`,
      `- \`session_attach\` — Attach to a child session and stream live events (with timeout).`,
      `- \`logs_get\` — Read a child session's transcript or raw event log (including in-progress sessions and optional live tailing).`,
    ].join("\n");
  }

  /** Orchestrator-specific completion contract. */
  private buildOrchestratorCompletionContract(): string {
    return [
      `## Completion`,
      `When all subtasks are complete and you have verified the results, use \`task_complete\` to signal your own completion. If any subtasks failed, decide whether to retry, reassign, or handle the failure before completing.`,
    ].join("\n");
  }

  // ─── Leaf Sections (unchanged) ───────────────────────────

  /** Task title, description, and notes. */
  private buildTaskContext(): string {
    const { title, description, notes } = this.options.task!;
    const parts = [
      `## Task: ${title}`,
      description,
    ];
    if (notes) {
      parts.push(`## Notes (from previous attempt or user feedback)\n${notes}`);
    }
    return parts.filter(Boolean).join("\n\n");
  }

  /** Contract for signaling task completion. */
  private buildCompletionContract(): string {
    return [
      `## Completion`,
      `When you are done with your task, use \`task_complete\` to signal completion. Do not go idle without signaling — the orchestrator depends on an explicit completion signal to know you are finished.`,
    ].join("\n");
  }

  /** Subtask guidance based on canDecompose. */
  private buildSubtaskSection(): string {
    if (this.options.canDecompose) {
      return [
        `## Subtasks`,
        `If this task is too large or complex to complete alone, use \`task_create\` to decompose it into subtasks. Monitor their progress with \`task_list\` and \`task_show\`. Wait for subtasks to finish before marking your own task complete.`,
      ].join("\n");
    }
    return [
      `## Subtasks`,
      `Subtask creation is disabled for this task. Complete the work yourself.`,
    ].join("\n");
  }

  /** Signal documentation (SIGCHLD + SIGTERM). */
  private buildSignalSection(): string {
    return [
      `## Signals`,
      `You may receive \`[SIGCHLD]\` messages when a child task finishes, fails, or is interrupted. When you receive one:`,
      `1. Review the child's status and last output (included in the signal).`,
      `2. If the child succeeded, check whether all subtasks are done and mark your task complete if so.`,
      `3. If the child failed or was interrupted, decide whether to retry, reassign, or handle the failure yourself.`,
      ``,
      `You may receive a \`[SIGTERM]\` message requesting graceful shutdown. When you receive one:`,
      `1. Finish your current operation (do not start new work).`,
      `2. Save any in-progress work (commit, push, or post findings).`,
      `3. If you have a parent pipe, write a final summary via \`ipc_write\`.`,
      `4. Close all **owned** child fds with \`ipc_close\` (do not close non-owned parent fds).`,
      `5. Call \`task_complete\` if your task is finished, or leave it for resumption if not.`,
      `6. Stop working after completing these steps.`,
    ].join("\n");
  }

  /** Guidance on using findings (leaf agents). */
  private buildFindingsSection(): string {
    return [
      `## Findings`,
      `Use \`finding_post\` to share discoveries (architecture decisions, bugs, patterns) with other agents. Check \`finding_list\` before posting to avoid duplicates.`,
    ].join("\n");
  }

  /** Previous session workpad (included when retrying a task that has workpad data). */
  private buildWorkpadSection(): string {
    if (!this.options.workpad) {
      return "";
    }
    return [
      `## Previous Session Workpad`,
      `A previous session on this task wrote the following workpad. Use this context to understand what was already accomplished and pick up where it left off.`,
      `\`\`\`json`,
      this.options.workpad,
      `\`\`\``,
    ].join("\n");
  }

  /** Instructions for writing to the workpad before completing. */
  private buildWorkpadWriteSection(): string {
    return [
      `## Workpad`,
      `Before completing your work, call \`workpad_write\` to record what you accomplished. Include a status, summary, and any structured data (branch, PR, files changed, blockers) in the extra field. This persists across sessions and helps retry agents pick up where you left off.`,
    ].join("\n");
  }

  /** IPC fd cleanup instructions — advisory enforcement for closing child fds before exit. */
  private buildIpcFdSection(): string {
    return [
      "## IPC File Descriptors",
      "",
      "If you spawn child sessions using `ipc_spawn`, you receive file descriptors (fds).",
      "Before finishing your work, you MUST:",
      "1. Call `ipc_list_fds` to check for open fds",
      "2. For each owned fd (`owned: true`), call `ipc_close` to close it",
      "3. Only then should you stop working",
      "",
      "Failing to close your fds will leave child sessions running indefinitely.",
    ].join("\n");
  }

  /** MCP note (always included). */
  private buildMcpNote(): string {
    return `You have tools on your \`grackle\` MCP server.`;
  }
}
