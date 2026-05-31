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

  // ─── Operator control plane (#1309) ──────────────────────────────────────────

  streams
    .command("create <name>")
    .description("Create an operator-owned room (survives at zero agents)")
    .option("--self-echo", "Chatroom mode: publishers receive their own messages echoed back")
    .action(async (name: string, opts: { selfEcho?: boolean }) => {
      const { core: client } = createGrackleClients();
      const res = await client.operatorCreateStream({ name, selfEcho: opts.selfEcho ?? false });
      console.log(`Created stream "${name}" (${res.streamId})`);
    });

  streams
    .command("attach <taskId> <streamId>")
    .description("Attach a task's latest live session to a stream")
    .option("--perm <perm>", 'Permission to grant: "r", "w", or "rw"', "rw")
    .option("--mode <mode>", 'Delivery mode: "sync", "async", or "detach"', "async")
    .action(async (taskId: string, streamId: string, opts: { perm: string; mode: string }) => {
      const { core: client } = createGrackleClients();
      const res = await client.operatorAttachTask({
        taskId,
        streamId,
        permission: opts.perm,
        deliveryMode: opts.mode,
      });
      console.log(
        `Attached task ${taskId} (session ${res.sessionId.slice(0, 8)}, fd=${String(res.fd)}) to ${streamId.slice(0, 8)}`,
      );
    });

  streams
    .command("detach <taskId> <streamId>")
    .description("Detach a task's latest live session from a stream")
    .action(async (taskId: string, streamId: string) => {
      const { core: client } = createGrackleClients();
      const res = await client.operatorDetachTask({ taskId, streamId });
      console.log(res.detached ? `Detached task ${taskId}` : "No matching attachment to detach.");
    });

  streams
    .command("attachments <taskId>")
    .description("List the rooms a task's latest live session is attached to")
    .action(async (taskId: string) => {
      const { core: client } = createGrackleClients();
      const res = await client.listTaskAttachments({ taskId });
      if (res.attachments.length === 0) {
        console.log("No attachments.");
        return;
      }
      const table = new Table({ head: ["Stream ID", "Name", "Session", "Permission", "Mode"] });
      for (const a of res.attachments) {
        table.push([
          a.streamId.slice(0, 8),
          a.streamName,
          a.sessionId.slice(0, 8),
          a.permission,
          a.deliveryMode,
        ]);
      }
      console.log(table.toString());
    });

  streams
    .command("close <streamId>")
    .description("Close an operator room (evict all subscribers, remove the stream)")
    .action(async (streamId: string) => {
      const { core: client } = createGrackleClients();
      const res = await client.operatorCloseStream({ streamId });
      console.log(res.closed ? `Closed stream ${streamId.slice(0, 8)}` : "Stream not found.");
    });
}
