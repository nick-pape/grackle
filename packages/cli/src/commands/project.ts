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
    .option("--name <name>", "New project name")
    .option("--desc <description>", "New project description")
    .option("--repo <url>", "New repository URL")
    .option("--env <env-id>", "New default environment ID")
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
        // --worktrees was passed (note: Commander may need explicit handling)
        useWorktrees = true;
      }

      const patch: {
        id: string;
        name?: string;
        description?: string;
        repoUrl?: string;
        defaultEnvironmentId?: string;
        useWorktrees?: boolean;
      } = { id };

      if (opts.name !== undefined) {
        patch.name = opts.name as string;
      }
      if (opts.desc !== undefined) {
        patch.description = opts.desc as string;
      }
      if (opts.repo !== undefined) {
        patch.repoUrl = opts.repo as string;
      }
      if (opts.env !== undefined) {
        patch.defaultEnvironmentId = opts.env as string;
      }
      if (useWorktrees !== undefined) {
        patch.useWorktrees = useWorktrees;
      }

      const hasChanges = Object.keys(patch).length > 1; // more than just 'id'
      if (!hasChanges) {
        console.error("No changes specified. Use --name, --desc, --repo, --env, --worktrees, or --no-worktrees.");
        process.exit(1);
      }

      const p = await client.updateProject(patch);
      console.log(`Updated project: ${p.id} (${p.name}) [worktrees: ${p.useWorktrees ? "enabled" : "disabled"}]`);
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
    .action(async (id: string, opts) => {
      const client = createGrackleClient();
      const p = await client.updateProject({
        id,
        name: opts.name,
        description: opts.desc,
        repoUrl: opts.repo,
        defaultEnvironmentId: opts.env,
      });
      console.log(`Updated project: ${p.id} (${p.name})`);
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
