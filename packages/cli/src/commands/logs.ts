import type { Command } from "commander";
import { ConnectError, Code } from "@connectrpc/connect";
import { createGrackleClient } from "../client.js";
import { eventTypeToString } from "@grackle-ai/common";

/** Register the `logs` command for viewing session logs, transcripts, and live tailing. */
export function registerLogCommands(program: Command): void {
  program
    .command("logs <session-id>")
    .description("View session event logs")
    .option("--transcript", "Show markdown transcript")
    .option("--tail", "Follow live events")
    .action(async (sessionId: string, opts: { transcript?: boolean; tail?: boolean }) => {
      const client = createGrackleClient();

      if (opts.tail) {
        // Stream live
        console.log(`Streaming session ${sessionId}...\n`);
        for await (const event of client.streamSession({ id: sessionId })) {
          const time = new Date(event.timestamp).toLocaleTimeString();
          console.log(`[${time}] ${eventTypeToString(event.type)}: ${event.content}`);
        }
        return;
      }

      // Get session info for log path — try exact match first, then prefix match
      let session: Awaited<ReturnType<typeof client.getSession>> | undefined;
      try {
        session = await client.getSession({ id: sessionId });
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          // Exact match failed — fall back to prefix match for short IDs
          const all = await client.listSessions({ environmentId: "", status: "" });
          session = all.sessions.find((s) => s.id.startsWith(sessionId));
        } else {
          throw error;
        }
      }

      if (!session) {
        console.error(`Session not found: ${sessionId}`);
        process.exit(1);
      }

      if (!session.logPath) {
        console.error("No log path for session");
        process.exit(1);
      }

      if (opts.transcript) {
        // Read transcript file
        const { readFileSync, existsSync } = await import("node:fs");
        const { join } = await import("node:path"); // eslint-disable-line @typescript-eslint/unbound-method
        const transcriptPath = join(session.logPath, "transcript.md");
        if (existsSync(transcriptPath)) {
          console.log(readFileSync(transcriptPath, "utf-8"));
        } else {
          console.error("Transcript not yet generated (session may still be running)");
        }
        return;
      }

      // Read JSONL
      const { readFileSync, existsSync } = await import("node:fs");
      const { join } = await import("node:path"); // eslint-disable-line @typescript-eslint/unbound-method
      const jsonlPath = join(session.logPath, "stream.jsonl");
      if (!existsSync(jsonlPath)) {
        console.error("No log file found");
        process.exit(1);
      }

      const lines = readFileSync(jsonlPath, "utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        const entry = JSON.parse(line) as { timestamp: string; type: string; content: string };
        const time = new Date(entry.timestamp).toLocaleTimeString();
        console.log(`[${time}] ${entry.type}: ${entry.content}`);
      }
    });
}
