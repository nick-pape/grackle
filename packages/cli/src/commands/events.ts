import type { Command } from "commander";
import Table from "cli-table3";
import { createGrackleClients } from "../client.js";

/** Max characters of an event payload shown inline in the table. */
const PAYLOAD_PREVIEW_LEN: number = 60;
/** Default row limit when --limit is omitted. */
const DEFAULT_LIMIT: string = "100";

/** Register the domain-event audit command: `grackle events`. */
export function registerEventCommands(program: Command): void {
  program
    .command("events")
    .description("Query the persisted domain-event log")
    .option("--type <type>", "Filter by exact event type (e.g. task.created)")
    .option("--since <iso>", "Only events at/after this ISO 8601 timestamp")
    .option("--until <iso>", "Only events at/before this ISO 8601 timestamp")
    .option("--after <id>", "Only events whose id sorts after this id (offset pagination)")
    .option("--limit <n>", "Max rows to return", DEFAULT_LIMIT)
    .action(async (opts: { type?: string; since?: string; until?: string; after?: string; limit?: string }) => {
      const { core: client } = createGrackleClients();
      const parsedLimit: number = Number.parseInt(opts.limit ?? DEFAULT_LIMIT, 10);
      const res = await client.queryDomainEvents({
        type: opts.type ?? "",
        since: opts.since ?? "",
        until: opts.until ?? "",
        afterId: opts.after ?? "",
        limit: Number.isFinite(parsedLimit) ? parsedLimit : 0,
      });
      if (res.events.length === 0) {
        console.log("No domain events.");
        return;
      }
      const table = new Table({ head: ["ID", "Type", "Timestamp", "Payload"] });
      for (const e of res.events) {
        const preview: string =
          e.payloadJson.length > PAYLOAD_PREVIEW_LEN
            ? `${e.payloadJson.slice(0, PAYLOAD_PREVIEW_LEN)}...`
            : e.payloadJson;
        table.push([e.id, e.type, e.timestamp, preview]);
      }
      console.log(table.toString());
    });
}
