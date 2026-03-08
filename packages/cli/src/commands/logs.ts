import { CommandLineAction, type CommandLineFlagParameter, type CommandLineStringParameter } from "@rushstack/ts-command-line";
import { createGrackleClient } from "../client.js";

/** Action: `logs` — view session logs, transcripts, and live tailing. */
export class LogsAction extends CommandLineAction {
  private readonly _sessionId: CommandLineStringParameter;
  private readonly _transcript: CommandLineFlagParameter;
  private readonly _tail: CommandLineFlagParameter;

  public constructor() {
    super({
      actionName: "logs",
      summary: "View session logs",
      documentation: "Displays logs for a session, optionally as a markdown transcript or live tail.",
    });

    this._sessionId = this.defineStringParameter({
      parameterLongName: "--session-id",
      argumentName: "SESSION_ID",
      description: "Session ID to view logs for",
      required: true,
    });
    this._transcript = this.defineFlagParameter({
      parameterLongName: "--transcript",
      description: "Show markdown transcript",
    });
    this._tail = this.defineFlagParameter({
      parameterLongName: "--tail",
      description: "Follow live events",
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    const sessionId = this._sessionId.value!;

    if (this._tail.value) {
      // Stream live
      console.log(`Streaming session ${sessionId}...\n`);
      for await (const event of client.streamSession({ id: sessionId })) {
        const time = new Date(event.timestamp).toLocaleTimeString();
        console.log(`[${time}] ${event.type}: ${event.content}`);
      }
      return;
    }

    // Get session info for log path
    const sessions = await client.listSessions({ environmentId: "", status: "" });
    const session = sessions.sessions.find((s) => s.id === sessionId || s.id.startsWith(sessionId));

    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      process.exit(1);
    }

    if (!session.logPath) {
      console.error("No log path for session");
      process.exit(1);
    }

    if (this._transcript.value) {
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
  }
}
