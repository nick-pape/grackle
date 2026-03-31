import type { Command } from "commander";
import chalk from "chalk";
import { createGrackleClient } from "../client.js";
import { grackle, SESSION_STATUS } from "@grackle-ai/common";
import Table from "cli-table3";
import { formatTokens, formatCost } from "../format.js";

/** Register agent-related commands: `spawn`, `resume`, `status`, `kill`, and `attach`. */
export function registerAgentCommands(program: Command): void {
  program
    .command("spawn <env-id> <prompt>")
    .description("Start a new agent session")
    .option("--max-turns <n>", "Maximum turns", parseInt)
    .option("--persona <id>", "Persona to use (falls back to app default)")
    .action(async (environmentId: string, prompt: string, opts: { maxTurns?: number; persona?: string }) => {
      const client = createGrackleClient();
      const session = await client.spawnAgent({
        environmentId,
        prompt,
        maxTurns: opts.maxTurns || 0,
        personaId: opts.persona || "",
      });
      console.log(`Spawned session: ${session.id}`);
      console.log(`Streaming events (Ctrl+C to detach)...\n`);

      // Auto-attach to stream
      for await (const event of client.streamSession({ id: session.id })) {
        printEvent(event);
      }
    });

  program
    .command("resume <session-id>")
    .description("Resume a paused session")
    .action(async (sessionId: string) => {
      const client = createGrackleClient();
      const session = await client.resumeAgent({ sessionId });
      console.log(`Resumed session: ${session.id}`);
    });

  program
    .command("status")
    .description("List agent sessions")
    .option("--env <env-id>", "Filter by environment")
    .option("--all", "Show all sessions including stopped")
    .action(async (opts: { env?: string; all?: boolean }) => {
      const client = createGrackleClient();
      const res = await client.listSessions({
        environmentId: opts.env || "",
        status: "",
      });
      const activeStatuses = new Set<string>([
        SESSION_STATUS.PENDING,
        SESSION_STATUS.RUNNING,
        SESSION_STATUS.IDLE,
      ]);
      const sessions = opts.all
        ? res.sessions
        : res.sessions.filter((s) => activeStatuses.has(s.status));
      if (sessions.length === 0) {
        console.log("No sessions.");
        return;
      }
      const table = new Table({
        head: ["ID", "Env", "Runtime", "Status", "Tokens", "Cost", "Prompt", "Started"],
      });
      for (const s of sessions) {
        const prompt =
          s.prompt.length > 40 ? s.prompt.slice(0, 40) + "..." : s.prompt;
        const tokens = (s.inputTokens || s.outputTokens)
          ? `${formatTokens(s.inputTokens)}→${formatTokens(s.outputTokens)}`
          : "-";
        const statusDisplay = s.status === "stopped" && s.endReason ? `${s.status} (${s.endReason})` : s.status;
        table.push([
          s.id.slice(0, 8),
          s.environmentId,
          s.runtime,
          statusDisplay,
          tokens,
          formatCost(s.costMillicents),
          prompt,
          s.startedAt,
        ]);
      }
      console.log(table.toString());
    });

  program
    .command("kill <session-id>")
    .description("Stop a running session")
    .option("-g, --graceful", "Send SIGTERM for graceful shutdown instead of hard kill")
    .action(async (sessionId: string, opts: { graceful?: boolean }) => {
      const client = createGrackleClient();
      await client.killAgent({ id: sessionId, graceful: opts.graceful ?? false });
      console.log(opts.graceful ? `Sent SIGTERM to: ${sessionId}` : `Killed: ${sessionId}`);
    });

  program
    .command("send-input <session-id> <text>")
    .description("Send input to a waiting session")
    .action(async (sessionId: string, text: string) => {
      const client = createGrackleClient();
      await client.sendInput({ sessionId, text });
      console.log(chalk.green(`Sent input to session ${sessionId}`));
    });

  program
    .command("attach <session-id>")
    .description("Attach to a live session")
    .action(async (sessionId: string) => {
      const client = createGrackleClient();
      console.log(`Attached to ${sessionId} (Ctrl+C to detach)\n`);

      const readline = await import("node:readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      let prompting = false;

      /** Prompt for input once and send the response. */
      function promptForInput(): void {
        if (prompting) {
          return;
        }
        prompting = true;
        rl.question("> ", (answer) => {
          prompting = false;
          client
            .sendInput({ sessionId, text: answer })
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              console.error(
                `Failed to send input for session ${sessionId}: ${message}`,
              );
            });
        });
      }

      for await (const event of client.streamSession({ id: sessionId })) {
        printEvent(event);
        if (
          event.type === grackle.EventType.STATUS &&
          event.content === "waiting_input"
        ) {
          promptForInput();
        }
      }

      rl.close();
    });
}

function printEvent(event: {
  type: grackle.EventType;
  content: string;
  timestamp: string;
}): void {
  const time = new Date(event.timestamp).toLocaleTimeString();
  switch (event.type) {
    case grackle.EventType.SYSTEM:
      console.log(chalk.gray(`[${time}] ${event.content}`));
      break;
    case grackle.EventType.TEXT:
      console.log(event.content);
      break;
    case grackle.EventType.TOOL_USE:
      console.log(chalk.blue(`> ${event.content}`));
      break;
    case grackle.EventType.TOOL_RESULT:
      console.log(chalk.gray(event.content));
      break;
    case grackle.EventType.ERROR:
      console.log(chalk.red(`[ERROR] ${event.content}`));
      break;
    case grackle.EventType.STATUS:
      console.log(chalk.yellow(`--- ${event.content} ---`));
      break;
  }
}
