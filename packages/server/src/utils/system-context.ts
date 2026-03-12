/** Build the system context string injected into task-spawned agent sessions. */
export function buildTaskSystemContext(title: string, description: string, reviewNotes: string, canDecompose?: boolean): string {
  const sections: string[] = [
    `## Task: ${title}`,
    description,
    reviewNotes ? `## Review Feedback (from previous attempt)\n${reviewNotes}` : "",
    `## Grackle Tools (MCP)`,
    `You have a "grackle" MCP server with tools for coordinating with other agents:`,
    `- **mcp__grackle__post_finding**: Share discoveries (architecture decisions, bugs, patterns) with other agents working on this project. Parameters: title (string), content (string), category (optional: architecture|api|bug|decision|dependency|pattern|general), tags (optional: string[]).`,
    `- **mcp__grackle__query_findings**: Query findings posted by other agents. Findings from previous tasks are also in your system context above.`,
  ];

  if (canDecompose) {
    sections.push(
      `- **mcp__grackle__create_subtask**: Delegate work to another agent by creating a child task. Use this when work is too large or complex for you to complete alone, or when a different specialization is needed. Each subtask runs in its own agent session. Parameters: title (string, required), description (string, required — be specific about what to do and what "done" looks like), local_id (string, optional — assign an ID to reference this subtask in depends_on of later subtasks), depends_on (string[], optional — local_ids of sibling subtasks that must finish first), can_decompose (boolean, optional, default false — set true if the subtask itself may need further decomposition).`,
    );
  }

  sections.push(
    `IMPORTANT: When you complete your task, post at least one finding summarizing what you did and any key decisions made.`,
  );

  return sections.filter(Boolean).join("\n\n");
}
