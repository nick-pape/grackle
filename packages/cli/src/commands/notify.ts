import type { Command } from "commander";
import { createGrackleClient } from "../client.js";
import Table from "cli-table3";

export function registerNotifyCommands(program: Command): void {
  const notify = program.command("notify").description("Manage human notifications and escalations");

  notify
    .command("send <title>")
    .description("Send an escalation notification to the human")
    .option("--workspace <id>", "Workspace ID", "")
    .option("--task <id>", "Task ID", "")
    .option("--message <text>", "Detailed message", "")
    .option("--urgency <level>", "Urgency: low, normal, high", "normal")
    .action(async (title: string, opts: { workspace: string; task: string; message: string; urgency: string }) => {
      const client = createGrackleClient();
      const esc = await client.createEscalation({
        workspaceId: opts.workspace,
        taskId: opts.task,
        title,
        message: opts.message || title,
        urgency: opts.urgency,
      });
      console.log(`Escalation created: ${esc.id} (status: ${esc.status})`);
    });

  notify
    .command("list")
    .description("List recent escalations")
    .option("--workspace <id>", "Filter by workspace ID")
    .option("--status <status>", "Filter by status: pending, delivered, acknowledged")
    .option("--limit <n>", "Max results", parseInt)
    .action(async (opts: { workspace?: string; status?: string; limit?: number }) => {
      const client = createGrackleClient();
      const res = await client.listEscalations({
        workspaceId: opts.workspace || "",
        status: opts.status || "",
        limit: opts.limit || 20,
      });
      if (res.escalations.length === 0) {
        console.log("No escalations.");
        return;
      }
      const table = new Table({
        head: ["ID", "Title", "Status", "Source", "Urgency", "Created"],
      });
      for (const e of res.escalations) {
        table.push([
          e.id.slice(0, 12),
          e.title.slice(0, 30),
          e.status,
          e.source,
          e.urgency,
          e.createdAt,
        ]);
      }
      console.log(table.toString());
    });

  notify
    .command("ack <id>")
    .description("Acknowledge an escalation")
    .action(async (id: string) => {
      const client = createGrackleClient();
      const esc = await client.acknowledgeEscalation({ id });
      console.log(`Acknowledged: ${esc.id} (status: ${esc.status})`);
    });

  notify
    .command("set-webhook <url>")
    .description("Configure a webhook URL for outbound notifications")
    .action(async (url: string) => {
      const client = createGrackleClient();
      await client.setSetting({ key: "webhook_url", value: url });
      console.log(`Webhook URL set: ${url}`);
    });

  notify
    .command("clear-webhook")
    .description("Remove the configured webhook URL")
    .action(async () => {
      const client = createGrackleClient();
      await client.setSetting({ key: "webhook_url", value: "" });
      console.log("Webhook URL cleared.");
    });

  notify
    .command("status")
    .description("Show notification configuration")
    .action(async () => {
      const client = createGrackleClient();
      const webhook = await client.getSetting({ key: "webhook_url" });
      const pending = await client.listEscalations({ workspaceId: "", status: "pending", limit: 0 });
      console.log(`Webhook URL: ${webhook.value || "(not configured)"}`);
      console.log(`Pending escalations: ${pending.escalations.length}`);
    });
}
