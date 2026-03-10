/** Build the system context string injected into task-spawned agent sessions. */
export function buildTaskSystemContext(title: string, description: string, reviewNotes: string): string {
  return [
    `## Task: ${title}`,
    description,
    reviewNotes ? `## Review Feedback (from previous attempt)\n${reviewNotes}` : "",
    `## Grackle Tools (MCP)`,
    `You have a "grackle" MCP server with tools for coordinating with other agents:`,
    `- **mcp__grackle__post_finding**: Share discoveries (architecture decisions, bugs, patterns) with other agents working on this project. Parameters: title (string), content (string), category (optional: architecture|api|bug|decision|dependency|pattern|general), tags (optional: string[]).`,
    `- **mcp__grackle__query_findings**: Query findings posted by other agents. Findings from previous tasks are also in your system context above.`,
    `IMPORTANT: When you complete your task, post at least one finding summarizing what you did and any key decisions made.`,
  ].filter(Boolean).join("\n\n");
}
