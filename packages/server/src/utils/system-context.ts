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
    `## Completion Checklist`,
    `When you have finished implementing the task, you MUST complete these steps in order:`,
    `1. **Build**: Run \`rush build\` (or the project's build command) and fix any errors.`,
    `2. **Test**: Run any relevant tests and ensure they pass.`,
    `3. **Commit**: Stage your changed files and create a descriptive git commit. Use a conventional commit message (e.g., \`fix: ...\`, \`feat: ...\`).`,
    `4. **Push**: Push your branch to origin: \`git push origin HEAD\``,
    `5. **Create PR**: Create a pull request using the gh CLI:\n   \`\`\`\n   gh pr create --title "your title" --body "summary of changes\\n\\nCloses #ISSUE"\n   \`\`\``,
    `6. **Post finding**: Use mcp__grackle__post_finding to summarize what you did and any key decisions.`,
    ``,
    `IMPORTANT: Do NOT stop at "waiting for input" — complete all 6 steps above before finishing. The PR is the deliverable.`,
  );

  return sections.filter(Boolean).join("\n\n");
}
