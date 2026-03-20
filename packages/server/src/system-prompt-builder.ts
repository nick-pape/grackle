/**
 * Builds system prompts for agent sessions, assembling sections
 * dynamically based on the session type (task vs ad-hoc).
 */

/** Options for building a system prompt. */
export interface SystemPromptOptions {
  /** Task metadata. When absent, this is an ad-hoc session. */
  task?: { title: string; description: string; notes: string };
  /** Whether the agent is allowed to create subtasks. */
  canDecompose?: boolean;
  /** Persona behavioral instructions (prepended when non-empty). */
  personaPrompt?: string;
}

/**
 * Assembles a system prompt from discrete sections based on session type.
 *
 * Task sessions get task context, completion contract, signal docs, and findings guidance.
 * Ad-hoc sessions get only the MCP note and persona prompt.
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
      sections.push(this.buildTaskContext());
      sections.push(this.buildCompletionContract());
      sections.push(this.buildSubtaskSection());
      sections.push(this.buildSignalSection());
      sections.push(this.buildFindingsSection());
    }

    // MCP note (always included)
    sections.push(this.buildMcpNote());

    return sections.filter(Boolean).join("\n\n");
  }

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

  /** SIGCHLD signal documentation. */
  private buildSignalSection(): string {
    return [
      `## Signals`,
      `You may receive \`[SIGCHLD]\` messages when a child task finishes, fails, or is interrupted. When you receive one:`,
      `1. Review the child's status and last output (included in the signal).`,
      `2. If the child succeeded, check whether all subtasks are done and mark your task complete if so.`,
      `3. If the child failed or was interrupted, decide whether to retry, reassign, or handle the failure yourself.`,
    ].join("\n");
  }

  /** Guidance on using findings. */
  private buildFindingsSection(): string {
    return [
      `## Findings`,
      `Use \`finding_post\` to share discoveries (architecture decisions, bugs, patterns) with other agents. Check \`finding_list\` before posting to avoid duplicates.`,
    ].join("\n");
  }

  /** MCP note (always included). */
  private buildMcpNote(): string {
    return `You have tools on your \`grackle\` MCP server.`;
  }
}
