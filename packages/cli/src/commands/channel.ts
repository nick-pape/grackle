import type { Command } from "commander";
import { createGrackleClients } from "../client.js";
import Table from "cli-table3";
import chalk from "chalk";

/** Register channel-exposure commands: `channel expose`, `ls`, `revoke`. */
export function registerChannelCommands(program: Command): void {
  const channel = program
    .command("channel")
    .description("Expose sessions to external systems via capability-scoped webhooks");

  channel
    .command("expose")
    .description("Mint a capability webhook URL that injects user messages into a session")
    .requiredOption("--session <id>", "Session ID to expose")
    .option("--verb <verb>", "Permitted verb", "send_input")
    .option("--ttl <seconds>", "Token lifetime in seconds (0 = server default)")
    .option("--label <text>", "Label for audit and revocation")
    .action(async (opts: { session: string; verb: string; ttl?: string; label?: string }) => {
      const { core: client } = createGrackleClients();
      const res = await client.exposeChannel({
        target: { case: "sessionId", value: opts.session },
        verbs: [opts.verb],
        ttlSeconds: opts.ttl ? Number(opts.ttl) : 0,
        label: opts.label || "",
      });
      console.log(`Channel:  ${res.channelUri}`);
      console.log(`Grant ID: ${res.grantId}`);
      console.log(chalk.bold(`Webhook:  ${res.ingressUrl}`));
      if (res.expiresAt) {
        console.log(`Expires:  ${res.expiresAt}`);
      }
    });

  channel
    .command("ls")
    .description("List channel grants")
    .action(async () => {
      const { core: client } = createGrackleClients();
      const res = await client.listChannelGrants({});
      if (res.grants.length === 0) {
        console.log("No channel grants.");
        return;
      }
      const table = new Table({
        head: ["Grant", "Channel", "Verbs", "Label", "Revoked", "Expires"],
      });
      for (const g of res.grants) {
        table.push([
          g.grantId.slice(0, 8),
          g.channelUri,
          g.verbs.join(","),
          g.label || "-",
          g.revoked ? chalk.red("yes") : chalk.green("no"),
          g.expiresAt || "-",
        ]);
      }
      console.log(table.toString());
    });

  channel
    .command("revoke <grant-id>")
    .description("Revoke a channel grant (its webhook URL stops working immediately)")
    .action(async (grantId: string) => {
      const { core: client } = createGrackleClients();
      await client.revokeChannelGrant({ grantId });
      console.log(`Revoked grant ${grantId}.`);
    });
}
