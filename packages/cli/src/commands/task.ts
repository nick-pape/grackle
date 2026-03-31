import type { Command } from "commander";
import { ConnectError, Code } from "@connectrpc/connect";
import { createGrackleClients } from "../client.js";
import {
  taskStatusToString,
  taskStatusToEnum,
  ROOT_TASK_ID,
} from "@grackle-ai/common";
import Table from "cli-table3";
import chalk from "chalk";
import { formatTokens, formatCost, formatBudget } from "../format.js";

export function registerTaskCommands(program: Command): void {
  const task = program.command("task").description("Create, start, and manage tasks");

  task
    .command("list [workspace-id]")
    .description("List tasks (optionally scoped to a workspace)")
    .option("--search <query>", "Filter tasks by title/description substring")
    .option("--status <status>", "Filter tasks by status (not_started, working, paused, complete, failed)")
    .action(async (workspaceId: string | undefined, opts: { search?: string; status?: string }) => {
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

      const { orchestration: client } = createGrackleClients();
      const res = await client.listTasks({
        workspaceId: workspaceId || "",
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
    .command("search <query>")
    .description("Fuzzy search for tasks by title or description, ranked by relevance")
    .option("--workspace <workspace-id>", "Scope to a specific workspace (optional)")
    .option("--limit <n>", "Maximum results to return (default 10)", parseInt)
    .option("--status <status>", "Filter by status (not_started, working, paused, complete, failed)")
    .action(async (query: string, opts: { workspace?: string; limit?: number; status?: string }) => {
      const { orchestration: client } = createGrackleClients();
      const res = await client.searchTasks({
        query,
        workspaceId: opts.workspace || "",
        limit: opts.limit ?? 0,
        status: opts.status || "",
      });
      if (res.results.length === 0) {
        console.log("No matching tasks.");
        return;
      }
      const table = new Table({
        head: ["Score", "ID", "Title", "Status"],
      });
      for (const r of res.results) {
        const t = r.task!;
        table.push([
          chalk.yellow((r.relevanceScore * 100).toFixed(0) + "%"),
          t.id,
          t.title.slice(0, 40),
          taskStatusToString(t.status),
        ]);
      }
      console.log(table.toString());
    });

  task
    .command("create <title>")
    .description("Create a task")
    .option("--workspace <workspace-id>", "Workspace to create the task in (optional)")
    .option("--desc <text>", "Task description")
    .option("--depends-on <ids>", "Comma-separated dependency task IDs")
    .option("--can-decompose", "Allow this task to create subtasks")
    .option("--parent <task-id>", "Parent task ID (creates a subtask)")
    .option("--token-budget <n>", "Total token cap (input + output); 0 = unlimited", parseInt)
    .option("--cost-budget-millicents <n>", "Cost cap in millicents ($0.00001 units); 0 = unlimited", parseInt)
    .action(async (title: string, opts: { workspace?: string; dependsOn?: string; desc?: string; canDecompose?: boolean; parent?: string; tokenBudget?: number; costBudgetMillicents?: number }) => {
      const { orchestration: client } = createGrackleClients();
      const dependsOn: string[] = opts.dependsOn
        ? opts.dependsOn.split(",").map((s: string) => s.trim()).filter(Boolean)
        : [];
      const t = await client.createTask({
        workspaceId: opts.workspace || "",
        title,
        description: opts.desc || "",
        dependsOn,
        canDecompose: opts.canDecompose || false,
        parentTaskId: opts.parent || "",
        tokenBudget: opts.tokenBudget,
        costBudgetMillicents: opts.costBudgetMillicents,
      });
      console.log(`Created task: ${t.id} (${t.title}) branch: ${t.branch}`);
    });

  task
    .command("show <task-id>")
    .description("Show task details")
    .action(async (taskId: string) => {
      const { orchestration: client, core } = createGrackleClients();
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
      if (t.description) {
        console.log(`Description: ${t.description}`);
      }
      // Show usage from the task scope
      try {
        const usage = await core.getUsage({ scope: "task", id: taskId });
        if (usage.inputTokens || usage.outputTokens || usage.costMillicents) {
          console.log(`Tokens:      ${formatTokens(usage.inputTokens)} in / ${formatTokens(usage.outputTokens)} out`);
          console.log(`Cost:        ${formatCost(usage.costMillicents)}`);
        }
        if (t.tokenBudget > 0) {
          const usedTokens = usage.inputTokens + usage.outputTokens;
          console.log(`Token Budget:  ${formatBudget(usedTokens, t.tokenBudget, "token")}`);
        }
        if (t.costBudgetMillicents > 0) {
          console.log(`Cost Budget:   ${formatBudget(usage.costMillicents, t.costBudgetMillicents, "cost")}`);
        }
      } catch (err: unknown) {
        // Only suppress NotFound (session cleaned up); surface other errors
        if (!(err instanceof ConnectError && err.code === Code.NotFound)) {
          console.log(chalk.yellow(`Tokens:      (unavailable)`));
        }
        // Still show budgets even if usage fetch fails
        if (t.tokenBudget > 0) {
          console.log(`Token Budget:  ${formatBudget(0, t.tokenBudget, "token")}`);
        }
        if (t.costBudgetMillicents > 0) {
          console.log(`Cost Budget:   ${formatBudget(0, t.costBudgetMillicents, "cost")}`);
        }
      }
      if (t.workpad) {
        try {
          const workpad = JSON.parse(t.workpad) as Record<string, unknown>;
          console.log(chalk.bold(`\nWorkpad:`));
          if (workpad.status) {
            console.log(`  Status:  ${String(workpad.status)}`);
          }
          if (workpad.summary) {
            console.log(`  Summary: ${String(workpad.summary)}`);
          }
          if (workpad.extra) {
            console.log(`  Extra:   ${JSON.stringify(workpad.extra)}`);
          }
        } catch {
          console.log(`Workpad:     ${t.workpad}`);
        }
      }
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
    .option("--persona <id>", "Default persona ID for this task")
    .option("--token-budget <n>", "Total token cap (input + output); 0 = unlimited", parseInt)
    .option("--cost-budget-millicents <n>", "Cost cap in millicents ($0.00001 units); 0 = unlimited", parseInt)
    .action(async (taskId: string, opts: { status?: string; dependsOn?: string; title?: string; desc?: string; session?: string; persona?: string; tokenBudget?: number; costBudgetMillicents?: number }) => {
      if (taskId === ROOT_TASK_ID && opts.status) {
        console.error(chalk.red("Cannot change the status of the system task"));
        process.exitCode = 1;
        return;
      }

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

      const { orchestration: client } = createGrackleClients();
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
        defaultPersonaId: opts.persona,
        tokenBudget: opts.tokenBudget,
        costBudgetMillicents: opts.costBudgetMillicents,
      });
      console.log(
        `Updated: ${t.id} (${t.title}) status: ${taskStatusToString(t.status)}`,
      );
    });

  task
    .command("start <task-id>")
    .description("Start a task (spawn agent)")
    .option("--persona <id-or-name>", "Persona override (falls back to task/workspace/app default)")
    .option("--env <env-id>", "Environment to run on")
    .option("--notes <text>", "Feedback/instructions for retry")
    .action(async (taskId: string, opts: { persona?: string; env?: string; notes?: string }) => {
      const { orchestration: client } = createGrackleClients();
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
      if (taskId === ROOT_TASK_ID) {
        console.error(chalk.red("Cannot delete the system task"));
        process.exitCode = 1;
        return;
      }
      const { orchestration: client } = createGrackleClients();
      await client.deleteTask({ id: taskId });
      console.log(`Deleted: ${taskId}`);
    });

  task
    .command("complete <task-id>")
    .description("Mark a task as complete")
    .action(async (taskId: string) => {
      if (taskId === ROOT_TASK_ID) {
        console.error(chalk.red("Cannot complete the system task"));
        process.exitCode = 1;
        return;
      }
      const { orchestration: client } = createGrackleClients();
      const t = await client.completeTask({ id: taskId });
      console.log(`Completed: ${t.id} → ${taskStatusToString(t.status)}`);
    });

  task
    .command("resume <task-id>")
    .description("Resume the latest interrupted/completed session for a task")
    .action(async (taskId: string) => {
      const { orchestration: client } = createGrackleClients();
      const session = await client.resumeTask({ id: taskId });
      console.log(`Resumed task. Session: ${session.id}`);
    });

}
