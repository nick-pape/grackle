import type { Command } from "commander";
import { createGrackleClient } from "../client.js";
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
        head: ["ID", "Name", "Env", "Status", "Created"],
      });
      for (const p of res.projects) {
        table.push([p.id, p.name, p.defaultEnvId || "-", p.status, p.createdAt]);
      }
      console.log(table.toString());
    });

  project
    .command("create <name>")
    .description("Create a new project")
    .option("--repo <url>", "Repository URL")
    .option("--env <env-id>", "Default environment ID")
    .option("--desc <description>", "Project description")
    .action(async (name: string, opts) => {
      const client = createGrackleClient();
      const p = await client.createProject({
        name,
        description: opts.desc || "",
        repoUrl: opts.repo || "",
        defaultEnvId: opts.env || "",
      });
      console.log(`Created project: ${p.id} (${p.name})`);
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
