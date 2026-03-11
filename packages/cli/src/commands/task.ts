import type { Command } from "commander";
import { createGrackleClient } from "../client.js";
import { taskStatusToString } from "@grackle-ai/common";
import Table from "cli-table3";
import chalk from "chalk";
import { execFileSync } from "node:child_process";

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
        table.push([t.id, t.title.slice(0, 30), taskStatusToString(t.status), t.branch.slice(0, 30), deps, t.sessionId?.slice(0, 8) || "-"]);
      }
      console.log(table.toString());
    });

  task
    .command("create <project-id> <title>")
    .description("Create a task")
    .option("--desc <text>", "Task description")
    .option("--env <env-id>", "Environment ID")
    .option("--depends-on <ids>", "Comma-separated dependency task IDs")
    .action(async (projectId: string, title: string, opts) => {
      const client = createGrackleClient();
      const dependsOn = opts.dependsOn ? opts.dependsOn.split(",") : [];
      const t = await client.createTask({
        projectId,
        title,
        description: opts.desc || "",
        environmentId: opts.env || "",
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
      console.log(`Env:         ${t.environmentId || "-"}`);
      console.log(`Session:     ${t.sessionId || "-"}`);
      console.log(`Depends On:  ${t.dependsOn.length > 0 ? t.dependsOn.join(", ") : "none"}`);
      if (t.description) console.log(`Description: ${t.description}`);
      if (t.reviewNotes) console.log(`Review Notes: ${t.reviewNotes}`);
    });

  task
    .command("start <task-id>")
    .description("Start a task (spawn agent)")
    .option("--runtime <runtime>", "Agent runtime")
    .option("--model <model>", "Model to use")
    .action(async (taskId: string, opts) => {
      const client = createGrackleClient();
      const session = await client.startTask({
        taskId,
        runtime: opts.runtime || "",
        model: opts.model || "",
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
      /**
       * Fetches GitHub issues via the `gh` CLI, deduplicates against existing
       * tasks (matched by issue number prefix `#<number>:`), and bulk-creates
       * any issues that have not yet been imported into the given project.
       *
       * @param projectId - The Grackle project ID to import tasks into.
       * @param opts - Parsed CLI options (repo, label, state, env).
       */
      async (projectId: string, opts: { repo: string; label?: string; state: string; env?: string }) => {
        const MAX_BUFFER_BYTES = 50 * 1024 * 1024;

        // 1. Fetch issues from GitHub CLI
        const ghArgs = [
          "issue",
          "list",
          "--repo",
          opts.repo,
          "--state",
          opts.state,
          "--json",
          "number,title,body,labels",
          "--limit",
          "9999",
        ];
        if (opts.label) {
          ghArgs.push("--label", opts.label);
        }
        let ghOutput: string;
        try {
          ghOutput = execFileSync("gh", ghArgs, {
            encoding: "utf8",
            maxBuffer: MAX_BUFFER_BYTES,
          });
        } catch (err) {
          console.error("Failed to run `gh issue list`. Is the GitHub CLI installed and authenticated?");
          console.error(err);
          process.exit(1);
        }

        interface GitHubIssue {
          number: number;
          title: string;
          body: string;
          labels: { name: string }[];
        }

        let issues: GitHubIssue[];
        try {
          issues = JSON.parse(ghOutput);
        } catch (err) {
          console.error("Failed to parse JSON output from `gh issue list`.");
          console.error("Parse error:", err);
          process.exit(1);
        }

        // 2. Fetch existing tasks for deduplication (match by issue number)
        const client = createGrackleClient();
        const res = await client.listTasks({ id: projectId });
        const issueNumberPattern = /^#(\d+):/;
        const existingIssueNumbers = new Set(
          res.tasks
            .map((t) => {
              const match = t.title.match(issueNumberPattern);
              return match ? Number(match[1]) : null;
            })
            .filter((n): n is number => n !== null)
        );

        // 3. Create tasks for issues not already imported
        let imported = 0;
        let skipped = 0;
        for (const issue of issues) {
          if (existingIssueNumbers.has(issue.number)) {
            skipped++;
            continue;
          }
          const title = `#${issue.number}: ${issue.title}`;
          await client.createTask({
            projectId,
            title,
            description: issue.body ?? "",
            environmentId: opts.env ?? "",
            dependsOn: [],
          });
          imported++;
        }

        // 4. Print summary
        console.log(
          `Imported ${chalk.green(imported)} tasks (skipped ${skipped} already imported)`
        );
      }
    );
}
