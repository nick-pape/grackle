#!/usr/bin/env node

import { Command } from "commander";
import { createClient, type Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { grackle, DEFAULT_SERVER_PORT } from "@grackle-ai/common";
import { fetchGitHubIssues } from "./github-client.js";
import { buildExistingIssueMap, planImport } from "./transform.js";

/** Result summary returned by the import process. */
interface ImportResult {
  imported: number;
  linked: number;
  skipped: number;
  dependencies: number;
}

/** Per-service ConnectRPC clients for the Grackle server. */
interface GrackleClients {
  core: Client<typeof grackle.GrackleCore>;
  orchestration: Client<typeof grackle.GrackleOrchestration>;
}

/** Create authenticated ConnectRPC clients for the Grackle server. */
function createGrackleClients(serverUrl: string, apiKey: string): GrackleClients {
  const transport = createGrpcTransport({
    baseUrl: serverUrl,
    interceptors: [
      (next) => async (req) => {
        req.header.set("Authorization", `Bearer ${apiKey}`);
        return next(req);
      },
    ],
  });
  return {
    core: createClient(grackle.GrackleCore, transport),
    orchestration: createClient(grackle.GrackleOrchestration, transport),
  };
}

/**
 * Import GitHub issues into a Grackle workspace.
 *
 * Orchestrates: validate workspace -> fetch issues -> dedup -> plan -> create tasks -> set deps.
 */
async function runImport(
  { core, orchestration }: GrackleClients,
  workspaceId: string,
  repo: string,
  state: string,
  label?: string,
  includeComments: boolean = true,
): Promise<ImportResult> {
  // 1. Validate workspace exists
  await core.getWorkspace({ id: workspaceId });

  // 2. Fetch issues from GitHub
  const issues = await fetchGitHubIssues(repo, state, label, includeComments);
  console.log(`Fetched ${issues.length} issues from ${repo} (state=${state})`);

  // 3. Get existing tasks for deduplication
  const existingTasksResponse = await orchestration.listTasks({ workspaceId });
  const existingTasks = existingTasksResponse.tasks.map((t) => ({ id: t.id, title: t.title }));
  const { issueNumberToTaskId: existingIssueNumberToTaskId, existingIssueNumbers } =
    buildExistingIssueMap(existingTasks);

  // 4. Plan the import (pure transform)
  let provisionalIdCounter = 0;
  const generateId = (): string => `provisional-${provisionalIdCounter++}`;
  const plan = planImport(issues, existingIssueNumbers, existingIssueNumberToTaskId, generateId);

  // 5. Create tasks via gRPC — map provisional IDs to server-assigned IDs
  const provisionalToReal = new Map<string, string>();

  for (const task of plan.tasksToCreate) {
    // Resolve parent: could be an existing task ID (already real) or a provisional ID we just created
    let realParentTaskId = "";
    if (task.parentTaskId) {
      realParentTaskId = provisionalToReal.get(task.parentTaskId) ?? task.parentTaskId;
    }

    const created = await orchestration.createTask({
      workspaceId,
      title: task.title,
      description: task.description,
      parentTaskId: realParentTaskId,
      canDecompose: true,
    });

    provisionalToReal.set(task.id, created.id);
  }

  // 6. Set dependency relationships
  let dependencies: number = 0;
  for (const dep of plan.dependenciesToSet) {
    const realTaskId = provisionalToReal.get(dep.taskId) ?? dep.taskId;
    const realDependsOn = dep.dependsOn.map((d) => provisionalToReal.get(d) ?? d);

    await orchestration.updateTask({
      id: realTaskId,
      dependsOn: realDependsOn,
    });
    dependencies += realDependsOn.length;
  }

  return {
    imported: plan.tasksToCreate.length,
    linked: plan.linked,
    skipped: plan.skipped,
    dependencies,
  };
}

/** Main CLI entry point. */
async function main(): Promise<void> {
  const program = new Command();

  program
    .name("import-github-issues")
    .description("Import GitHub issues as Grackle tasks")
    .requiredOption("--workspace <id>", "Grackle workspace ID")
    .requiredOption("--repo <owner/repo>", "GitHub repository (e.g., nick-pape/grackle)")
    .option("--label <label>", "Filter issues by label")
    .option("--state <state>", "Issue state: open or closed", "open")
    .option("--no-include-comments", "Skip fetching issue comments")
    .action(async (options: {
      workspace: string;
      repo: string;
      label?: string;
      state: string;
      includeComments: boolean;
    }) => {
      const serverUrl = process.env.GRACKLE_URL ?? `http://127.0.0.1:${DEFAULT_SERVER_PORT}`;
      const apiKey = process.env.GRACKLE_API_KEY;
      if (!apiKey) {
        console.error("Error: GRACKLE_API_KEY environment variable is required.");
        process.exit(1);
      }

      const normalizedState = options.state.trim().toLowerCase();
      if (normalizedState !== "open" && normalizedState !== "closed") {
        console.error(`Error: --state must be "open" or "closed" (received: "${options.state}")`);
        process.exit(1);
      }

      const client = createGrackleClients(serverUrl, apiKey);

      try {
        const result = await runImport(
          client,
          options.workspace,
          options.repo,
          normalizedState,
          options.label,
          options.includeComments,
        );

        console.log(`Import complete: ${result.imported} imported, ${result.linked} linked, ${result.skipped} skipped, ${result.dependencies} dependencies`);
      } catch (err) {
        console.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
