/** Build the system context string injected into task-spawned agent sessions. */
export function buildTaskSystemContext(title: string, description: string, notes: string, canDecompose?: boolean): string {
  const sections: string[] = [
    `## Task: ${title}`,
    description,
    notes ? `## Notes (from previous attempt or user feedback)\n${notes}` : "",
    `## Grackle Tools (MCP)`,
    `You have a "grackle" MCP server with tools for coordinating with other agents:`,
    `- **mcp__grackle__post_finding** (alias: mcp__grackle__finding_post): Share discoveries (architecture decisions, bugs, patterns) with other agents working on this project. Parameters: projectId (string — injected automatically, you can pass any value or your project ID), title (string, required), content (string, optional), category (optional: architecture|api|bug|decision|dependency|pattern|general), tags (optional: string[]).`,
    `- **mcp__grackle__query_findings** (alias: mcp__grackle__finding_list): Query findings posted by other agents. Parameters: projectId (string — injected automatically), category (optional), tag (optional), limit (optional). Findings from previous tasks are also in your system context above.`,
  ];

  if (canDecompose) {
    sections.push(
      `- **mcp__grackle__task_create**: Create a new task in the project. Use this when work is too large or complex for you to complete alone. Parameters: projectId (string — injected automatically), title (string, required), description (string, optional — be specific about what to do and what "done" looks like).`,
    );
  }

  sections.push(
    `## Completion Checklist`,
    `When you have finished implementing the task, you MUST complete ALL steps below in order. Do NOT stop early or go to "waiting for input" until every step is done.`,
    ``,
    `### Phase 1: Implement & Test`,
    `1. **Implement** the task requirements.`,
    `2. **Write tests**: Write unit tests, integration tests, or E2E specs as appropriate. Every implementation MUST include tests unless the change is purely cosmetic or untestable (state why if skipping).`,
    `3. **Build**: Run the project's build command and fix any errors.`,
    `4. **Run tests**: Run relevant tests and ensure they pass.`,
    `5. **Manual test**: If the change affects UI, visually verify. If it affects CLI or API, run the commands manually. State explicitly if skipping and why.`,
    ``,
    `### Phase 2: Create PR`,
    `6. **Sync with main**: Fetch and merge the main branch. If merge conflicts arise, resolve them, stage, and commit the merge. NEVER rebase.`,
    `7. **Rebuild after merge**: If the merge brought in new commits, rebuild to catch integration conflicts.`,
    `8. **Commit**: Stage your changed files and create a descriptive git commit. Use a conventional commit message (e.g., \`fix: ...\`, \`feat: ...\`).`,
    `9. **Push**: Push your branch to the remote.`,
    `10. **Create PR**: Create a pull request that links back to the issue (e.g., "Closes #ISSUE").`,
    ``,
    `### Phase 3: PR Readiness (you MUST complete this — do NOT skip)`,
    `After creating the PR, you must ensure it is ready to merge.`,
    ``,
    `11. **Check for merge conflicts**: Verify the PR has no merge conflicts. If it does, fetch and merge the main branch, resolve conflicts, rebuild, commit, and push.`,
    `12. **Wait for CI**: Wait for all CI checks to complete. If any check fails, read the logs, fix the issue, commit, push, and repeat.`,
    `13. **Address code review comments**: Check for automated code review comments. For each unresolved comment: read the suggestion, fix the code or dismiss with an explanation, reply to the comment, and resolve the thread. After fixing, commit, push, and check again. Repeat until all review threads are resolved.`,
    `14. **Post finding**: Use mcp__grackle__post_finding to summarize what you did and any key decisions.`,
    ``,
    `IMPORTANT: The PR is the deliverable, but a PR with failing CI or unresolved review comments is NOT done. You MUST complete Phase 3. Do NOT go to "waiting for input" until CI is green AND all review threads are resolved.`,
  );

  return sections.filter(Boolean).join("\n\n");
}
