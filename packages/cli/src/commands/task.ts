import type { Command } from "commander";
import { createGrackleClient } from "../client.js";
import {
  taskStatusToString,
  taskStatusToEnum,
  issueStateToEnum,
} from "@grackle-ai/common";
import Table from "cli-table3";
import chalk from "chalk";

export function registerTaskCommands(program: Command): void {
  const task = program.command("task").description("Create, start, and manage tasks");

  task
    .command("list [project-id]")
    .description("List tasks (optionally scoped to a project)")
    .option("--search <query>", "Filter tasks by title/description substring")
    .option("--status <status>", "Filter tasks by status (not_started, working, paused, complete, failed)")
    .action(async (projectId: string | undefined, opts: { search?: string; status?: string }) => {
      const VALID_STATUSES = new Set([
        "not_started",
        "working",
        "paused",
        "complete",
        "failed",
      ]);

      if (
        opts.status !== undefined &&
        !VALID_STATUSES.has(String(opts.status).toLowerCase())
      ) {
        console.error(
          `Invalid status: "${opts.status}". Valid values are: ${[...VALID_STATUSES].join(", ")}`,
        );
        process.exitCode = 1;
        return;
      }

      const client = createGrackleClient();
      const res = await client.listTasks({
        projectId: projectId || "",
        search: opts.search || "",
        status: opts.status ? String(opts.status).toLowerCase() : "",
      });
      if (res.tasks.length === 0) {
        console.log("No tasks.");
        return;
      }
      const table = new Table({
        head: ["ID", "Title", "Status", "Branch", "Deps", "Session"],
      });
      for (const t of res.tasks) {
        const deps = t.dependsOn.length > 0 ? t.dependsOn.join(",") : "-";
        table.push([
          t.id,
          t.title.slice(0, 30),
          taskStatusToString(t.status),
          t.branch.slice(0, 30),
          deps,
          t.latestSessionId.slice(0, 8) || "-",
        ]);
      }
      console.log(table.toString());
    });

  task
    .command("create <title>")
    .description("Create a task")
    .option("--project <project-id>", "Project to create the task in (optional)")
    .option("--desc <text>", "Task description")
    .option("--depends-on <ids>", "Comma-separated dependency task IDs")
    .action(async (title: string, opts: { project?: string; dependsOn?: string; desc?: string }) => {
      const client = createGrackleClient();
      const dependsOn: string[] = opts.dependsOn
        ? opts.dependsOn.split(",").map((s: string) => s.trim()).filter(Boolean)
        : [];
      const t = await client.createTask({
        projectId: opts.project || "",
        title,
        description: opts.desc || "",
        dependsOn,
      });
      console.log(`Created task: ${t.id} (${t.title}) branch: ${t.branch}`);
    });

  task
    .command("show <task-id>")
    .description("Show task details")
    .action(async (taskId: string) => {
      const client = createGrackleClient();
      const t = await client.getTask({ id: taskId });
      console.log(`ID:          ${t.id}`);
      console.log(`Title:       ${t.title}`);
      console.log(`Status:      ${taskStatusToString(t.status)}`);
      console.log(`Branch:      ${t.branch}`);
      console.log(`Session:     ${t.latestSessionId || "-"}`);
      console.log(
        `Depends On:  ${t.dependsOn.length > 0 ? t.dependsOn.join(", ") : "none"}`,
      );
      console.log(`Decompose:   ${t.canDecompose ? "yes" : "no"}`);
      if (t.description) console.log(`Description: ${t.description}`);
    });

  task
    .command("update <task-id>")
    .description("Update a task")
    .option("--title <text>", "New title")
    .option("--desc <text>", "New description")
    .option(
      "--status <status>",
      "Task status (not_started, working, paused, complete, failed)",
    )
    .option("--depends-on <ids>", "Comma-separated dependency task IDs")
    .option("--session <session-id>", "Bind an existing session to this task")
    .action(async (taskId: string, opts: { status?: string; dependsOn?: string; title?: string; desc?: string; session?: string }) => {
      const VALID_STATUSES = new Set([
        "not_started",
        "working",
        "paused",
        "complete",
        "failed",
      ]);

      if (
        opts.status !== undefined &&
        !VALID_STATUSES.has(String(opts.status).toLowerCase())
      ) {
        console.error(
          `Invalid status: "${opts.status}". Valid values are: ${[...VALID_STATUSES].join(", ")}`,
        );
        process.exitCode = 1;
        return;
      }

      const client = createGrackleClient();
      const dependsOn: string[] = opts.dependsOn
        ? opts.dependsOn.split(",").map((s: string) => s.trim()).filter(Boolean)
        : [];
      const t = await client.updateTask({
        id: taskId,
        title: opts.title || "",
        description: opts.desc || "",
        status: opts.status
          ? taskStatusToEnum(String(opts.status).toLowerCase())
          : taskStatusToEnum(""),
        dependsOn,
        sessionId: opts.session || "",
      });
      console.log(
        `Updated: ${t.id} (${t.title}) status: ${taskStatusToString(t.status)}`,
      );
    });

  task
    .command("start <task-id>")
    .description("Start a task (spawn agent)")
    .option("--persona <id-or-name>", "Persona override (falls back to task/project/app default)")
    .option("--env <env-id>", "Environment to run on")
    .option("--notes <text>", "Feedback/instructions for retry")
    .action(async (taskId: string, opts: { persona?: string; env?: string; notes?: string }) => {
      const client = createGrackleClient();
      const session = await client.startTask({
        taskId,
        personaId: opts.persona || "",
        environmentId: opts.env || "",
        notes: opts.notes || "",
      });
      console.log(`Task started. Session: ${session.id}`);
    });

  task
    .command("delete <task-id>")
    .description("Delete a task")
    .action(async (taskId: string) => {
      const client = createGrackleClient();
      await client.deleteTask({ id: taskId });
      console.log(`Deleted: ${taskId}`);
    });

  task
    .command("complete <task-id>")
    .description("Mark a task as complete")
    .action(async (taskId: string) => {
      const client = createGrackleClient();
      const t = await client.completeTask({ id: taskId });
      console.log(`Completed: ${t.id} → ${taskStatusToString(t.status)}`);
    });

  task
    .command("resume <task-id>")
    .description("Resume the latest interrupted/completed session for a task")
    .action(async (taskId: string) => {
      const client = createGrackleClient();
      const session = await client.resumeTask({ id: taskId });
      console.log(`Resumed task. Session: ${session.id}`);
    });

  task
    .command("import-github <project-id>")
    .description("Bulk import GitHub issues as tasks")
    .requiredOption("--repo <owner/repo>", "GitHub repository (owner/repo)")
    .option("--label <label>", "Filter issues by label name")
    .option("--state <state>", "Issue state to fetch", "open")
    .option("--env <env-id>", "Environment ID to assign to created tasks")
    .option("--no-include-comments", "Exclude issue comments from imported task descriptions")
    .action(
      async (
        projectId: string,
        opts: { repo: string; label?: string; state: string; env?: string; includeComments: boolean },
      ) => {
        const normalizedState = opts.state.trim().toLowerCase();
        if (normalizedState !== "open" && normalizedState !== "closed") {
          console.error(
            chalk.red(
              `Invalid --state "${opts.state}". Must be "open" or "closed".`,
            ),
          );
          process.exitCode = 1;
          return;
        }
        const client = createGrackleClient();
        const res = await client.importGitHubIssues({
          projectId,
          repo: opts.repo,
          label: opts.label,
          state: issueStateToEnum(normalizedState),
          environmentId: opts.env,
          includeComments: opts.includeComments,
        });
        const parts = [`Imported ${chalk.green(res.imported)} tasks`];
        if (res.linked > 0) {
          parts.push(`${chalk.cyan(res.linked)} linked to parents`);
        }
        if (res.dependencies > 0) {
          parts.push(`${chalk.yellow(res.dependencies)} blocking relationships`);
        }
        parts.push(`skipped ${res.skipped} already imported`);
        console.log(parts.join(", "));
      },
    );
}
