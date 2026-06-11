import type { Command } from "commander";
import { createGrackleClients } from "../client.js";
import Table from "cli-table3";
import chalk from "chalk";

/** Register schedule management commands: `schedule list`, `create`, `show`, `edit`, `enable`, `disable`, `delete`. */
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
        head: ["ID", "Title", "Schedule", "Persona", "Agent", "Enabled", "Last Run", "Next Run"],
      });
      for (const s of res.schedules) {
        table.push([
          s.id.slice(0, 8),
          s.title,
          s.scheduleExpression,
          s.personaId || "-",
          s.agentId ? s.agentId.slice(0, 8) : "-",
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
    .requiredOption(
      "--schedule <expression>",
      "Interval (e.g. '30s', '5m') or cron expression (e.g. '0 9 * * MON')",
    )
    .option("--persona <id>", "Persona ID to use when firing (required if --agent is not set)")
    .option("--agent <id>", "Owning Agent ID — fires under the Agent's identity (#1439)")
    .option("--desc <text>", "Description")
    .option("--workspace <id>", "Workspace scope")
    .option("--parent-task <id>", "Parent task for spawned children")
    .action(
      async (
        title: string,
        opts: {
          schedule: string;
          persona?: string;
          agent?: string;
          desc?: string;
          workspace?: string;
          parentTask?: string;
        },
      ) => {
        if (!opts.persona && !opts.agent) {
          console.error("Error: --persona or --agent is required");
          process.exit(1);
        }
        const { scheduling: client } = createGrackleClients();
        const res = await client.createSchedule({
          title,
          scheduleExpression: opts.schedule,
          personaId: opts.persona || "",
          agentId: opts.agent || "",
          description: opts.desc || "",
          workspaceId: opts.workspace || "",
          parentTaskId: opts.parentTask || "",
        });
        console.log(`Created schedule: ${res.id}`);
        console.log(`  Title:    ${res.title}`);
        console.log(`  Schedule: ${res.scheduleExpression}`);
        if (res.agentId) {
          console.log(`  Agent:    ${res.agentId}`);
        }
        if (res.personaId) {
          console.log(`  Persona:  ${res.personaId}`);
        }
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
      if (res.agentId) {
        console.log(`Agent:       ${res.agentId}`);
      }
      console.log(`Persona:     ${res.personaId || "(inherited from agent)"}`);
      console.log(`Workspace:   ${res.workspaceId || "(system-level)"}`);
      console.log(`Parent Task: ${res.parentTaskId || "(root)"}`);
      console.log(`Enabled:     ${res.enabled ? chalk.green("yes") : chalk.red("no")}`);
      console.log(`Run Count:   ${res.runCount}`);
      console.log(`Last Run:    ${res.lastRunAt || "-"}`);
      console.log(`Next Run:    ${res.nextRunAt || "-"}`);
      console.log(`Created:     ${res.createdAt}`);
    });

  schedule
    .command("edit <id>")
    .description("Edit a schedule")
    .option("--title <text>", "New title")
    .option("--desc <text>", "New description")
    .option("--schedule <expression>", "New interval or cron expression")
    .option("--persona <id>", "New persona ID")
    .option("--agent <id>", "Attach an owning Agent by ID (#1439)")
    .option("--no-agent", "Detach the owning Agent (fire as unowned schedule)")
    .action(
      async (
        id: string,
        opts: {
          title?: string;
          desc?: string;
          schedule?: string;
          persona?: string;
          agent?: string | boolean;
        },
      ) => {
        const { scheduling: client } = createGrackleClients();

        // Build the partial update request — only include fields the user provided.
        // Commander sets --no-agent as `agent: false`, --agent <id> as the string.
        const req: Parameters<typeof client.updateSchedule>[0] = { id };
        if (opts.title) {
          req.title = opts.title;
        }
        if (opts.desc !== undefined) {
          req.description = opts.desc;
        }
        if (opts.schedule) {
          req.scheduleExpression = opts.schedule;
        }
        if (opts.persona) {
          req.personaId = opts.persona;
        }
        if (opts.agent === false) {
          // --no-agent: detach (send empty string, which the handler maps to null)
          req.agentId = "";
        } else if (typeof opts.agent === "string" && opts.agent) {
          req.agentId = opts.agent;
        }

        const res = await client.updateSchedule(req);
        console.log(`Updated schedule: ${res.id}`);
        if (res.agentId) {
          console.log(`  Agent:    ${res.agentId}`);
        }
        if (res.personaId) {
          console.log(`  Persona:  ${res.personaId}`);
        }
        console.log(`  Schedule: ${res.scheduleExpression}`);
        console.log(`  Enabled:  ${res.enabled ? chalk.green("yes") : chalk.red("no")}`);
      },
    );

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
