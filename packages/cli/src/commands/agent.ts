import type { Command } from "commander";
import chalk from "chalk";
import { createGrackleClient } from "../client.js";
import Table from "cli-table3";

export function registerAgentCommands(program: Command): void {
  program
    .command("spawn <env-id> <prompt>")
    .description("Spawn an agent on an environment")
    .option("--model <model>", "Model to use")
    .option("--max-turns <n>", "Maximum turns", parseInt)
    .option("--runtime <runtime>", "Agent runtime")
    .action(async (envId: string, prompt: string, opts) => {
      const client = createGrackleClient();
      const session = await client.spawnAgent({
        envId,
        prompt,
        model: opts.model || "",
        maxTurns: opts.maxTurns || 0,
        runtime: opts.runtime || "",
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
    .description("Resume a suspended session")
    .action(async (sessionId: string) => {
      const client = createGrackleClient();
      const session = await client.resumeAgent({ sessionId });
      console.log(`Resumed session: ${session.id}`);
    });

  program
    .command("status")
    .description("List active sessions")
    .option("--env <env-id>", "Filter by environment")
    .option("--all", "Show all sessions including completed")
    .action(async (opts) => {
      const client = createGrackleClient();
      const res = await client.listSessions({
        envId: opts.env || "",
        status: opts.all ? "" : "active",
      });
      if (res.sessions.length === 0) {
        console.log("No sessions.");
        return;
      }
      const table = new Table({
        head: ["ID", "Env", "Runtime", "Status", "Prompt", "Started"],
      });
      for (const s of res.sessions) {
        const prompt = s.prompt.length > 40 ? s.prompt.slice(0, 40) + "..." : s.prompt;
        table.push([s.id.slice(0, 8), s.envId, s.runtime, s.status, prompt, s.startedAt]);
      }
      console.log(table.toString());
    });

  program
    .command("kill <session-id>")
    .description("Kill a running session")
    .action(async (sessionId: string) => {
      const client = createGrackleClient();
      await client.killAgent({ id: sessionId });
      console.log(`Killed: ${sessionId}`);
    });

  program
    .command("attach <session-id>")
    .description("Attach to a session stream with interactive input")
    .action(async (sessionId: string) => {
      const client = createGrackleClient();
      console.log(`Attached to ${sessionId} (Ctrl+C to detach)\n`);

      // Set up stdin for input
      const readline = await import("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      // Stream events
      const streamPromise = (async () => {
        for await (const event of client.streamSession({ id: sessionId })) {
          printEvent(event);
          if (event.type === "status" && event.content === "waiting_input") {
            rl.question("> ", async (answer) => {
              await client.sendInput({ sessionId, text: answer });
            });
          }
        }
      })();

      await streamPromise;
      rl.close();
    });
}

function printEvent(event: { type: string; content: string; timestamp: string }): void {
  const time = new Date(event.timestamp).toLocaleTimeString();
  switch (event.type) {
    case "system":
      console.log(chalk.gray(`[${time}] ${event.content}`));
      break;
    case "text":
      console.log(event.content);
      break;
    case "tool_use":
      console.log(chalk.blue(`> ${event.content}`));
      break;
    case "tool_result":
      console.log(chalk.gray(event.content));
      break;
    case "error":
      console.log(chalk.red(`[ERROR] ${event.content}`));
      break;
    case "status":
      console.log(chalk.yellow(`--- ${event.content} ---`));
      break;
  }
}
