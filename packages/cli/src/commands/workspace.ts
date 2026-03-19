import type { Command } from "commander";
import { createGrackleClient } from "../client.js";
import { workspaceStatusToString } from "@grackle-ai/common";
import Table from "cli-table3";

export function registerWorkspaceCommands(program: Command): void {
  const workspace = program.command("workspace").description("Create and manage workspaces");

  workspace
    .command("list")
    .description("List all active workspaces")
    .action(async () => {
      const client = createGrackleClient();
      const res = await client.listWorkspaces({});
      if (res.workspaces.length === 0) {
        console.log("No workspaces.");
        return;
      }
      const table = new Table({
        head: ["ID", "Name", "Env", "Worktrees", "Status", "Created"],
      });
      for (const p of res.workspaces) {
        table.push([p.id, p.name, p.defaultEnvironmentId || "-", p.useWorktrees ? "enabled" : "disabled", workspaceStatusToString(p.status), p.createdAt]);
      }
      console.log(table.toString());
    });

  workspace
    .command("create <name>")
    .description("Create a new workspace")
    .option("--repo <url>", "Repository URL")
    .option("--env <env-id>", "Default environment ID")
    .option("--desc <description>", "Workspace description")
    .option("--no-worktrees", "Disable worktree isolation (agents share the main checkout)")
    .option("--worktree-base-path <path>", "Base path for worktrees (e.g. /workspaces/my-repo)")
    .action(async (name: string, opts: { worktrees?: boolean; desc?: string; repo?: string; env?: string; worktreeBasePath?: string }) => {
      const client = createGrackleClient();
      // Commander sets opts.worktrees = false when --no-worktrees is passed, true otherwise
      const useWorktrees = opts.worktrees !== false;
      const p = await client.createWorkspace({
        name,
        description: opts.desc || "",
        repoUrl: opts.repo || "",
        defaultEnvironmentId: opts.env || "",
        useWorktrees,
        worktreeBasePath: opts.worktreeBasePath || "",
      });
      console.log(`Created workspace: ${p.id} (${p.name}) [worktrees: ${p.useWorktrees ? "enabled" : "disabled"}]`);
    });

  workspace
    .command("get <id>")
    .description("Show full workspace details")
    .action(async (id: string) => {
      const client = createGrackleClient();
      const p = await client.getWorkspace({ id });
      const table = new Table();
      table.push(
        { "ID": p.id },
        { "Name": p.name },
        { "Description": p.description || "-" },
        { "Repo URL": p.repoUrl || "-" },
        { "Default Env": p.defaultEnvironmentId || "-" },
        { "Worktrees": p.useWorktrees ? "enabled" : "disabled" },
        ...(p.worktreeBasePath ? [{ "Worktree Base": p.worktreeBasePath }] : []),
        { "Status": workspaceStatusToString(p.status) },
        { "Created": p.createdAt },
        { "Updated": p.updatedAt },
      );
      console.log(table.toString());
    });

  workspace
    .command("update <id>")
    .description("Update a workspace")
    .option("--name <name>", "Workspace name")
    .option("--desc <description>", "Workspace description")
    .option("--repo <url>", "Repository URL")
    .option("--env <env-id>", "Default environment ID")
    .option("--no-worktrees", "Disable worktree isolation (agents share the main checkout)")
    .option("--worktrees", "Enable worktree isolation (default)")
    .option("--worktree-base-path <path>", "Base path for worktrees (e.g. /workspaces/my-repo)")
    .action(async (id: string, opts: { worktrees?: boolean; name?: string; desc?: string; repo?: string; env?: string; worktreeBasePath?: string }) => {
      const client = createGrackleClient();
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
        defaultEnvironmentId: opts.env,
        useWorktrees,
        worktreeBasePath: opts.worktreeBasePath,
      });
      console.log(`Updated workspace: ${p.id} (${p.name}) [worktrees: ${p.useWorktrees ? "enabled" : "disabled"}]`);
    });

  workspace
    .command("archive <id>")
    .description("Archive a workspace")
    .action(async (id: string) => {
      const client = createGrackleClient();
      await client.archiveWorkspace({ id });
      console.log(`Archived: ${id}`);
    });
}
