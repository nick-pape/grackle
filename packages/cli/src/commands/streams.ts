import type { Command } from "commander";
import Table from "cli-table3";
import { createGrackleClients } from "../client.js";

/** Register stream inspection commands: `streams list`. */
export function registerStreamCommands(program: Command): void {
  const streams = program.command("streams").description("Inspect IPC streams");

  streams
    .command("list")
    .description("List active IPC streams with subscriber details")
    .action(async () => {
      const { core: client } = createGrackleClients();
      const res = await client.listStreams({});
      if (res.streams.length === 0) {
        console.log("No active streams.");
        return;
      }
      const table = new Table({
        head: ["ID", "Name", "Subscribers", "Buffer Depth"],
      });
      for (const s of res.streams) {
        table.push([
          s.id.slice(0, 8),
          s.name,
          String(s.subscriberCount),
          String(s.messageBufferDepth),
        ]);
        for (const sub of s.subscribers) {
          table.push([
            "",
            `  ${sub.sessionId.slice(0, 8)}`,
            `  fd=${String(sub.fd)} ${sub.permission}/${sub.deliveryMode}`,
            sub.createdBySpawn ? "  (spawned)" : "",
          ]);
        }
      }
      console.log(table.toString());
    });
}
