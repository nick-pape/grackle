import type { Command } from "commander";
import { createGrackleClient } from "../client.js";
import { projectStatusToString } from "@grackle-ai/common";
import Table from "cli-table3";

export function registerProjectCommands(program: Command): void {
  const project = program.command("project").description("Manage projects");

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
        table.push([
          p.id,
          p.name,
          p.defaultEnvironmentId || "-",
          p.useWorktrees ? "enabled" : "disabled",
          projectStatusToString(p.status),
          p.createdAt,
        ]);
      }
      console.log(table.toString());
    });

  project
    .command("create <name>")
    .description("Create a new project")
    .option("--repo <url>", "Repository URL")
    .option("--env <env-id>", "Default environment ID")
    .option("--desc <description>", "Project description")
    .option("--no-worktrees", "Disable worktree isolation (agents work in the main checkout)")
    .action(async (name: string, opts) => {
      const client = createGrackleClient();
      // Commander sets opts.worktrees = false when --no-worktrees is passed
      const useWorktrees = opts.worktrees !== false;
      const p = await client.createProject({
        name,
        description: opts.desc || "",
        repoUrl: opts.repo || "",
        defaultEnvironmentId: opts.env || "",
        useWorktrees,
      });
      console.log(`Created project: ${p.id} (${p.name}) [worktrees: ${p.useWorktrees ? "enabled" : "disabled"}]`);
    });

  project
    .command("update <id>")
    .description("Update project settings")
    .option("--no-worktrees", "Disable worktree isolation for this project")
    .option("--worktrees", "Enable worktree isolation for this project")
    .action(async (id: string, opts) => {
      const client = createGrackleClient();
      // Determine the useWorktrees value from flags
      let useWorktrees: boolean | undefined;
      if (opts.worktrees === false) {
        // --no-worktrees was passed
        useWorktrees = false;
      } else if (opts.worktrees === true) {
        // --worktrees was passed
        useWorktrees = true;
      }
      if (useWorktrees === undefined) {
        console.error("No changes specified. Use --worktrees or --no-worktrees.");
        process.exit(1);
      }
      const p = await client.updateProject({ id, useWorktrees });
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
