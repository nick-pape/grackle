import type { Command } from "commander";
import { createGrackleClients } from "../client.js";
import { workspaceStatusToString } from "@grackle-ai/common";
import Table from "cli-table3";
import { formatTokens, formatCost, formatBudget } from "../format.js";

export function registerWorkspaceCommands(program: Command): void {
  const workspace = program.command("workspace").description("Create and manage workspaces");

  workspace
    .command("list")
    .description("List all active workspaces")
    .option("--env <env-id>", "Filter by environment ID")
    .action(async (opts: { env?: string }) => {
      const { core: client } = createGrackleClients();
      const res = await client.listWorkspaces({ environmentId: opts.env || "" });
      if (res.workspaces.length === 0) {
        console.log("No workspaces.");
        return;
      }
      const table = new Table({
        head: ["ID", "Name", "Linked Envs", "Worktrees", "Status", "Created"],
      });
      for (const p of res.workspaces) {
        table.push([p.id, p.name, p.linkedEnvironmentIds.join(", ") || "-", p.useWorktrees ? "enabled" : "disabled", workspaceStatusToString(p.status), p.createdAt]);
      }
      console.log(table.toString());
    });

  workspace
    .command("create <name>")
    .description("Create a new workspace")
    .requiredOption("--env <env-id>", "Environment ID (required, auto-linked as the initial environment)")
    .option("--repo <url>", "Repository URL")
    .option("--desc <description>", "Workspace description")
    .option("--no-worktrees", "Disable worktree isolation (agents share the main checkout)")
    .option("--working-directory <path>", "Working directory / repo root on the environment (e.g. /workspaces/my-repo)")
    .option("--worktree-base-path <path>", "(deprecated, use --working-directory)")
    .option("--token-budget <n>", "Aggregate token cap across all tasks; 0 = unlimited", parseInt)
    .option("--cost-budget-millicents <n>", "Aggregate cost cap in millicents ($0.00001 units); 0 = unlimited", parseInt)
    .action(async (name: string, opts: { worktrees?: boolean; desc?: string; repo?: string; env: string; workingDirectory?: string; worktreeBasePath?: string; tokenBudget?: number; costBudgetMillicents?: number }) => {
      const { core: client } = createGrackleClients();
      // Commander sets opts.worktrees = false when --no-worktrees is passed, true otherwise
      const useWorktrees = opts.worktrees !== false;
      const p = await client.createWorkspace({
        name,
        description: opts.desc || "",
        repoUrl: opts.repo || "",
        environmentId: opts.env,
        useWorktrees,
        workingDirectory: opts.workingDirectory || opts.worktreeBasePath || "",
        tokenBudget: opts.tokenBudget,
        costBudgetMillicents: opts.costBudgetMillicents,
      });
      console.log(`Created workspace: ${p.id} (${p.name}) [worktrees: ${p.useWorktrees ? "enabled" : "disabled"}]`);
    });

  workspace
    .command("get <id>")
    .description("Show full workspace details")
    .action(async (id: string) => {
      const { core: client } = createGrackleClients();
      const p = await client.getWorkspace({ id });
      // Fetch usage for budget display
      let usage: { inputTokens: number; outputTokens: number; costMillicents: number } | undefined;
      try {
        usage = await client.getUsage({ scope: "workspace", id });
      } catch {
        // Usage fetch may fail; continue without it
      }

      const table = new Table();
      table.push(
        { "ID": p.id },
        { "Name": p.name },
        { "Description": p.description || "-" },
        { "Repo URL": p.repoUrl || "-" },
        { "Linked Envs": p.linkedEnvironmentIds.length > 0 ? p.linkedEnvironmentIds.join(", ") : "none" },
        { "Worktrees": p.useWorktrees ? "enabled" : "disabled" },
        ...(p.workingDirectory ? [{ "Working Dir": p.workingDirectory }] : []),
        { "Status": workspaceStatusToString(p.status) },
        { "Created": p.createdAt },
        { "Updated": p.updatedAt },
      );
      if (usage && (usage.inputTokens || usage.outputTokens || usage.costMillicents)) {
        table.push(
          { "Tokens": `${formatTokens(usage.inputTokens)} in / ${formatTokens(usage.outputTokens)} out` },
          { "Cost": formatCost(usage.costMillicents) },
        );
      }
      if (p.tokenBudget > 0) {
        const usedTokens = usage ? usage.inputTokens + usage.outputTokens : 0;
        table.push({ "Token Budget": formatBudget(usedTokens, p.tokenBudget, "token") });
      }
      if (p.costBudgetMillicents > 0) {
        const usedCost = usage ? usage.costMillicents : 0;
        table.push({ "Cost Budget": formatBudget(usedCost, p.costBudgetMillicents, "cost") });
      }
      console.log(table.toString());
    });

  workspace
    .command("update <id>")
    .description("Update a workspace")
    .option("--name <name>", "Workspace name")
    .option("--desc <description>", "Workspace description")
    .option("--repo <url>", "Repository URL")
    .option("--no-worktrees", "Disable worktree isolation (agents share the main checkout)")
    .option("--worktrees", "Enable worktree isolation (default)")
    .option("--working-directory <path>", "Working directory / repo root on the environment (e.g. /workspaces/my-repo)")
    .option("--worktree-base-path <path>", "(deprecated, use --working-directory)")
    .option("--token-budget <n>", "Aggregate token cap across all tasks; 0 = unlimited", parseInt)
    .option("--cost-budget-millicents <n>", "Aggregate cost cap in millicents ($0.00001 units); 0 = unlimited", parseInt)
    .action(async (id: string, opts: { worktrees?: boolean; name?: string; desc?: string; repo?: string; workingDirectory?: string; worktreeBasePath?: string; tokenBudget?: number; costBudgetMillicents?: number }) => {
      const { core: client } = createGrackleClients();
      // Determine useWorktrees: explicit --worktrees → true, --no-worktrees → false, neither → undefined (no change)
      let useWorktrees: boolean | undefined;
      if (opts.worktrees === true) {
        useWorktrees = true;
      } else if (opts.worktrees === false) {
        useWorktrees = false;
      }
      const p = await client.updateWorkspace({
        id,
        name: opts.name,
        description: opts.desc,
        repoUrl: opts.repo,
        useWorktrees,
        workingDirectory: opts.workingDirectory || opts.worktreeBasePath,
        tokenBudget: opts.tokenBudget,
        costBudgetMillicents: opts.costBudgetMillicents,
      });
      console.log(`Updated workspace: ${p.id} (${p.name}) [worktrees: ${p.useWorktrees ? "enabled" : "disabled"}]`);
    });

  workspace
    .command("archive <id>")
    .description("Archive a workspace")
    .action(async (id: string) => {
      const { core: client } = createGrackleClients();
      await client.archiveWorkspace({ id });
      console.log(`Archived: ${id}`);
    });

  workspace
    .command("link-env <workspace-id>")
    .description("Link an additional environment to a workspace")
    .requiredOption("--env <env-id>", "Environment ID to link")
    .action(async (workspaceId: string, opts: { env: string }) => {
      const { core: client } = createGrackleClients();
      const p = await client.linkEnvironment({ workspaceId, environmentId: opts.env });
      console.log(`Linked environment ${opts.env} to workspace ${p.id} (${p.name})`);
    });

  workspace
    .command("unlink-env <workspace-id>")
    .description("Remove a linked environment from a workspace")
    .requiredOption("--env <env-id>", "Environment ID to unlink")
    .action(async (workspaceId: string, opts: { env: string }) => {
      const { core: client } = createGrackleClients();
      const p = await client.unlinkEnvironment({ workspaceId, environmentId: opts.env });
      console.log(`Unlinked environment ${opts.env} from workspace ${p.id} (${p.name})`);
    });
}
