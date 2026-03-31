import type { Command } from "commander";
import { createGrackleClients } from "../client.js";
import Table from "cli-table3";
import chalk from "chalk";

/** Register schedule management commands: `schedule list`, `create`, `show`, `enable`, `disable`, `delete`. */
export function registerScheduleCommands(program: Command): void {
  const schedule = program.command("schedule").description("Create and manage scheduled triggers");

  schedule
    .command("list")
    .description("List all schedules")
    .option("--workspace <id>", "Filter by workspace ID")
    .action(async (opts: { workspace?: string }) => {
      const { scheduling: client } = createGrackleClients();
      const res = await client.listSchedules({
        workspaceId: opts.workspace || "",
      });
      if (res.schedules.length === 0) {
        console.log("No schedules.");
        return;
      }
      const table = new Table({
        head: ["ID", "Title", "Schedule", "Persona", "Enabled", "Last Run", "Next Run"],
      });
      for (const s of res.schedules) {
        table.push([
          s.id.slice(0, 8),
          s.title,
          s.scheduleExpression,
          s.personaId,
          s.enabled ? chalk.green("yes") : chalk.red("no"),
          s.lastRunAt || "-",
          s.nextRunAt || "-",
        ]);
      }
      console.log(table.toString());
    });

  schedule
    .command("create <title>")
    .description("Create a scheduled trigger")
    .requiredOption("--schedule <expression>", "Interval (e.g. '30s', '5m') or cron expression (e.g. '0 9 * * MON')")
    .requiredOption("--persona <id>", "Persona ID to use when firing")
    .option("--desc <text>", "Description")
    .option("--environment <id>", "Environment to run on (auto-select if omitted)")
    .option("--workspace <id>", "Workspace scope")
    .option("--parent-task <id>", "Parent task for spawned children")
    .action(
      async (
        title: string,
        opts: {
          schedule: string;
          persona: string;
          desc?: string;
          environment?: string;
          workspace?: string;
          parentTask?: string;
        },
      ) => {
        const { scheduling: client } = createGrackleClients();
        const res = await client.createSchedule({
          title,
          scheduleExpression: opts.schedule,
          personaId: opts.persona,
          description: opts.desc || "",
          environmentId: opts.environment || "",
          workspaceId: opts.workspace || "",
          parentTaskId: opts.parentTask || "",
        });
        console.log(`Created schedule: ${res.id}`);
        console.log(`  Title:    ${res.title}`);
        console.log(`  Schedule: ${res.scheduleExpression}`);
        console.log(`  Persona:  ${res.personaId}`);
        console.log(`  Next run: ${res.nextRunAt}`);
      },
    );

  schedule
    .command("show <id>")
    .description("Show schedule details")
    .action(async (id: string) => {
      const { scheduling: client } = createGrackleClients();
      const res = await client.getSchedule({ id });
      console.log(`ID:          ${res.id}`);
      console.log(`Title:       ${res.title}`);
      console.log(`Description: ${res.description || "(none)"}`);
      console.log(`Schedule:    ${res.scheduleExpression}`);
      console.log(`Persona:     ${res.personaId}`);
      console.log(`Environment: ${res.environmentId || "(auto-select)"}`);
      console.log(`Workspace:   ${res.workspaceId || "(system-level)"}`);
      console.log(`Parent Task: ${res.parentTaskId || "(root)"}`);
      console.log(`Enabled:     ${res.enabled ? chalk.green("yes") : chalk.red("no")}`);
      console.log(`Run Count:   ${res.runCount}`);
      console.log(`Last Run:    ${res.lastRunAt || "-"}`);
      console.log(`Next Run:    ${res.nextRunAt || "-"}`);
      console.log(`Created:     ${res.createdAt}`);
    });

  schedule
    .command("enable <id>")
    .description("Enable a schedule")
    .action(async (id: string) => {
      const { scheduling: client } = createGrackleClients();
      await client.updateSchedule({ id, enabled: true });
      console.log(`Schedule ${id} enabled.`);
    });

  schedule
    .command("disable <id>")
    .description("Disable a schedule")
    .action(async (id: string) => {
      const { scheduling: client } = createGrackleClients();
      await client.updateSchedule({ id, enabled: false });
      console.log(`Schedule ${id} disabled.`);
    });

  schedule
    .command("delete <id>")
    .description("Delete a schedule (running tasks are not affected)")
    .action(async (id: string) => {
      const { scheduling: client } = createGrackleClients();
      await client.deleteSchedule({ id });
      console.log(`Deleted schedule ${id}.`);
    });
}
