import type { Command } from "commander";
import { createGrackleClient } from "../client.js";

export function registerLogCommands(program: Command): void {
  program
    .command("logs <session-id>")
    .description("View session logs")
    .option("--transcript", "Show markdown transcript")
    .option("--tail", "Follow live events")
    .action(async (sessionId: string, opts) => {
      const client = createGrackleClient();

      if (opts.tail) {
        // Stream live
        console.log(`Streaming session ${sessionId}...\n`);
        for await (const event of client.streamSession({ id: sessionId })) {
          const time = new Date(event.timestamp).toLocaleTimeString();
          console.log(`[${time}] ${event.type}: ${event.content}`);
        }
        return;
      }

      // Get session info for log path
      const sessions = await client.listSessions({ envId: "", status: "" });
      const session = sessions.sessions.find((s) => s.id === sessionId || s.id.startsWith(sessionId));

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
        const { join } = await import("node:path");
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
      const { join } = await import("node:path");
      const jsonlPath = join(session.logPath, "stream.jsonl");
      if (!existsSync(jsonlPath)) {
        console.error("No log file found");
        process.exit(1);
      }

      const lines = readFileSync(jsonlPath, "utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        const entry = JSON.parse(line);
        const time = new Date(entry.timestamp).toLocaleTimeString();
        console.log(`[${time}] ${entry.type}: ${entry.content}`);
      }
    });
}
