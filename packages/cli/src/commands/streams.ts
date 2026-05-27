import type { Command } from "commander";
import Table from "cli-table3";
import { createGrackleClients } from "../client.js";

/** Max characters of message content shown inline in the transcript table. */
const CONTENT_PREVIEW_LEN: number = 80;
/** Default transcript row limit when --limit is omitted. */
const DEFAULT_TRANSCRIPT_LIMIT: string = "100";

/** Register stream inspection commands: `streams list`, `streams transcript`. */
export function registerStreamCommands(program: Command): void {
  const streams = program.command("streams").description("Inspect IPC streams");

  streams
    .command("list")
    .description("List active IPC streams with subscriber details")
    .option("--internal", "Include internal IPC streams (lifecycle/pipe/stdin)")
    .action(async (opts: { internal?: boolean }) => {
      const { core: client } = createGrackleClients();
      const res = await client.listStreams({ includeInternal: opts.internal ?? false });
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

  streams
    .command("transcript <streamId>")
    .description("Show a stream room's durable transcript (most recent first)")
    .option("--before <seq>", "Only messages older than this seq (page into history)")
    .option("--limit <n>", "Max messages to return", DEFAULT_TRANSCRIPT_LIMIT)
    .action(async (streamId: string, opts: { before?: string; limit?: string }) => {
      const limitArg: string = (opts.limit ?? DEFAULT_TRANSCRIPT_LIMIT).trim();
      if (!/^\d+$/.test(limitArg)) {
        throw new Error(`Invalid --limit: "${opts.limit}" (expected a non-negative integer)`);
      }
      const { core: client } = createGrackleClients();
      const res = await client.getStreamTranscript({
        streamId,
        beforeSeq: opts.before ?? "",
        limit: Number.parseInt(limitArg, 10),
      });
      if (res.messages.length === 0) {
        console.log("No messages.");
        return;
      }
      const table = new Table({ head: ["Seq", "Sender", "Timestamp", "Content"] });
      for (const m of res.messages) {
        const preview: string =
          m.content.length > CONTENT_PREVIEW_LEN
            ? `${m.content.slice(0, CONTENT_PREVIEW_LEN)}...`
            : m.content;
        table.push([m.seq, m.senderId.slice(0, 8), m.timestamp, preview]);
      }
      console.log(table.toString());
    });
}
