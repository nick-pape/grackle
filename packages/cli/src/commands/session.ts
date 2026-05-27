import type { Command } from "commander";
import Table from "cli-table3";
import { createGrackleClients } from "../client.js";

/** Max characters of action content shown inline in the table. */
const CONTENT_PREVIEW_LEN: number = 80;
/** Default row limit when --limit is omitted. */
const DEFAULT_LIMIT: string = "500";

/** Register session inspection commands: `session events`. */
export function registerSessionCommands(program: Command): void {
  const session = program.command("session").description("Inspect sessions");

  session
    .command("events <sessionId>")
    .description(
      "Show a session's durable, server-sequenced action log (oldest first / replay order)",
    )
    .option("--from <seq>", "Only actions after this seq (resume from a cursor)")
    .option("--limit <n>", "Max actions to return", DEFAULT_LIMIT)
    .action(async (sessionId: string, opts: { from?: string; limit?: string }) => {
      const limitArg: string = (opts.limit ?? DEFAULT_LIMIT).trim();
      if (!/^\d+$/.test(limitArg)) {
        throw new Error(`Invalid --limit: "${opts.limit}" (expected a non-negative integer)`);
      }
      const { core: client } = createGrackleClients();
      const res = await client.getSessionActions({
        sessionId,
        fromSeq: opts.from ?? "",
        limit: Number.parseInt(limitArg, 10),
      });
      if (res.actions.length === 0) {
        console.log("No session actions.");
        return;
      }
      const table = new Table({ head: ["Seq", "Type", "Timestamp", "Content"] });
      for (const a of res.actions) {
        const preview: string =
          a.content.length > CONTENT_PREVIEW_LEN
            ? `${a.content.slice(0, CONTENT_PREVIEW_LEN)}...`
            : a.content;
        table.push([a.seq, a.type, a.timestamp, preview]);
      }
      console.log(table.toString());
    });
}
