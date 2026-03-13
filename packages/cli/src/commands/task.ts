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
  const task = program.command("task").description("Manage tasks");

  task
    .command("list <project-id>")
    .description("List tasks in a project")
    .action(async (projectId: string) => {
      const client = createGrackleClient();
      const res = await client.listTasks({ id: projectId });
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
          t.sessionId?.slice(0, 8) || "-",
        ]);
      }
      console.log(table.toString());
    });

  task
    .command("create <project-id> <title>")
    .description("Create a task")
    .option("--desc <text>", "Task description")
    .option("--env <env-id>", "Environment ID")
    .option("--depends-on <ids>", "Comma-separated dependency task IDs")
    .option("--persona <id-or-name>", "Persona to assign")
    .action(async (projectId: string, title: string, opts) => {
      const client = createGrackleClient();
      const dependsOn = opts.dependsOn ? opts.dependsOn.split(",") : [];
      const t = await client.createTask({
        projectId,
        title,
        description: opts.desc || "",
        environmentId: opts.env || "",
        dependsOn,
        personaId: opts.persona || "",
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
      console.log(`Env:         ${t.environmentId || "-"}`);
      console.log(`Session:     ${t.sessionId || "-"}`);
      console.log(
        `Depends On:  ${t.dependsOn.length > 0 ? t.dependsOn.join(", ") : "none"}`,
      );
      if (t.description) console.log(`Description: ${t.description}`);
      if (t.personaId) console.log(`Persona:     ${t.personaId}`);
      if (t.reviewNotes) console.log(`Review Notes: ${t.reviewNotes}`);
    });

  task
    .command("update <task-id>")
    .description("Update a task")
    .option("--title <text>", "New title")
    .option("--desc <text>", "New description")
    .option("--env <env-id>", "Environment ID")
    .option(
      "--status <status>",
      "Task status (pending, assigned, in_progress, review, done, failed)",
    )
    .option("--notes <text>", "Review notes")
    .action(async (taskId: string, opts) => {
      const VALID_STATUSES = new Set([
        "pending",
        "assigned",
        "in_progress",
        "review",
        "done",
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
      const t = await client.updateTask({
        id: taskId,
        title: opts.title || "",
        description: opts.desc || "",
        environmentId: opts.env || "",
        status: opts.status
          ? taskStatusToEnum(String(opts.status).toLowerCase())
          : taskStatusToEnum(""),
        reviewNotes: opts.notes || "",
      });
      console.log(
        `Updated: ${t.id} (${t.title}) status: ${taskStatusToString(t.status)} env: ${t.environmentId || "-"}`,
      );
    });

  task
    .command("start <task-id>")
    .description("Start a task (spawn agent)")
    .option("--runtime <runtime>", "Agent runtime")
    .option("--model <model>", "Model to use")
    .option("--persona <id-or-name>", "Persona to use")
    .action(async (taskId: string, opts) => {
      const client = createGrackleClient();
      const session = await client.startTask({
        taskId,
        runtime: opts.runtime || "",
        model: opts.model || "",
        personaId: opts.persona || "",
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
    .command("approve <task-id>")
    .description("Approve a task in review")
    .action(async (taskId: string) => {
      const client = createGrackleClient();
      const t = await client.approveTask({ id: taskId });
      console.log(`Approved: ${t.id} → ${taskStatusToString(t.status)}`);
    });

  task
    .command("reject <task-id>")
    .description("Reject a task in review")
    .option("--notes <text>", "Review notes", "")
    .action(async (taskId: string, opts) => {
      const client = createGrackleClient();
      const t = await client.rejectTask({
        id: taskId,
        reviewNotes: opts.notes,
      });
      console.log(`Rejected: ${t.id} → ${taskStatusToString(t.status)}`);
    });

  task
    .command("import-github <project-id>")
    .description("Bulk import GitHub issues as tasks")
    .requiredOption("--repo <owner/repo>", "GitHub repository (owner/repo)")
    .option("--label <label>", "Filter issues by label name")
    .option("--state <state>", "Issue state to fetch", "open")
    .option("--env <env-id>", "Environment ID to assign to created tasks")
    .action(
      async (
        projectId: string,
        opts: { repo: string; label?: string; state: string; env?: string },
      ) => {
        const normalizedState = (opts.state ?? "").trim().toLowerCase();
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
        });
        const parts = [`Imported ${chalk.green(res.imported)} tasks`];
        if (res.linked > 0) {
          parts.push(`${chalk.cyan(res.linked)} linked to parents`);
        }
        parts.push(`skipped ${res.skipped} already imported`);
        console.log(parts.join(", "));
      },
    );
}
