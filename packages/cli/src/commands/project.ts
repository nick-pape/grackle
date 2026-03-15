import type { Command } from "commander";
import { createGrackleClient } from "../client.js";
import { projectStatusToString } from "@grackle-ai/common";
import Table from "cli-table3";

export function registerProjectCommands(program: Command): void {
  const project = program.command("project").description("Create and manage projects");

  project
    .command("list")
    .description("List all active projects")
    .action(async () => {
      const client = createGrackleClient();
      const res = await client.listProjects({});
      if (res.projects.length === 0) {
        console.log("No projects.");
        return;
      }
      const table = new Table({
        head: ["ID", "Name", "Env", "Worktrees", "Status", "Created"],
      });
      for (const p of res.projects) {
        table.push([p.id, p.name, p.defaultEnvironmentId || "-", p.useWorktrees ? "enabled" : "disabled", projectStatusToString(p.status), p.createdAt]);
      }
      console.log(table.toString());
    });

  project
    .command("create <name>")
    .description("Create a new project")
    .option("--repo <url>", "Repository URL")
    .option("--env <env-id>", "Default environment ID")
    .option("--desc <description>", "Project description")
    .option("--no-worktrees", "Disable worktree isolation (agents share the main checkout)")
    .option("--worktree-base-path <path>", "Base path for worktrees (e.g. /workspaces/my-repo)")
    .action(async (name: string, opts: { worktrees?: boolean; desc?: string; repo?: string; env?: string; worktreeBasePath?: string }) => {
      const client = createGrackleClient();
      // Commander sets opts.worktrees = false when --no-worktrees is passed, true otherwise
      const useWorktrees = opts.worktrees !== false;
      const p = await client.createProject({
        name,
        description: opts.desc || "",
        repoUrl: opts.repo || "",
        defaultEnvironmentId: opts.env || "",
        useWorktrees,
        worktreeBasePath: opts.worktreeBasePath || "",
      });
      console.log(`Created project: ${p.id} (${p.name}) [worktrees: ${p.useWorktrees ? "enabled" : "disabled"}]`);
    });

  project
    .command("get <id>")
    .description("Show full project details")
    .action(async (id: string) => {
      const client = createGrackleClient();
      const p = await client.getProject({ id });
      const table = new Table();
      table.push(
        { "ID": p.id },
        { "Name": p.name },
        { "Description": p.description || "-" },
        { "Repo URL": p.repoUrl || "-" },
        { "Default Env": p.defaultEnvironmentId || "-" },
        { "Worktrees": p.useWorktrees ? "enabled" : "disabled" },
        ...(p.worktreeBasePath ? [{ "Worktree Base": p.worktreeBasePath }] : []),
        { "Status": projectStatusToString(p.status) },
        { "Created": p.createdAt },
        { "Updated": p.updatedAt },
      );
      console.log(table.toString());
    });

  project
    .command("update <id>")
    .description("Update a project")
    .option("--name <name>", "Project name")
    .option("--desc <description>", "Project description")
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
      const p = await client.updateProject({
        id,
        name: opts.name,
        description: opts.desc,
        repoUrl: opts.repo,
        defaultEnvironmentId: opts.env,
        useWorktrees,
        worktreeBasePath: opts.worktreeBasePath,
      });
      console.log(`Updated project: ${p.id} (${p.name}) [worktrees: ${p.useWorktrees ? "enabled" : "disabled"}]`);
    });

  project
    .command("archive <id>")
    .description("Archive a project")
    .action(async (id: string) => {
      const client = createGrackleClient();
      await client.archiveProject({ id });
      console.log(`Archived: ${id}`);
    });
}
