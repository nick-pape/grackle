import {
  CommandLineAction,
  type CommandLineFlagParameter,
  type CommandLineIntegerParameter,
  type CommandLineStringParameter,
} from "@rushstack/ts-command-line";
import chalk from "chalk";
import { createGrackleClient } from "../client.js";
import Table from "cli-table3";

/** Action: `spawn` — spawn an agent on an environment. */
export class SpawnAction extends CommandLineAction {
  private readonly _environmentId: CommandLineStringParameter;
  private readonly _prompt: CommandLineStringParameter;
  private readonly _model: CommandLineStringParameter;
  private readonly _maxTurns: CommandLineIntegerParameter;
  private readonly _runtime: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "spawn",
      summary: "Spawn an agent on an environment",
      documentation: "Spawns a new agent session on the specified environment and streams its output.",
    });

    this._environmentId = this.defineStringParameter({
      parameterLongName: "--env-id",
      argumentName: "ENV_ID",
      description: "Environment ID to spawn the agent on",
      required: true,
    });
    this._prompt = this.defineStringParameter({
      parameterLongName: "--prompt",
      argumentName: "PROMPT",
      description: "Initial prompt for the agent",
      required: true,
    });
    this._model = this.defineStringParameter({
      parameterLongName: "--model",
      argumentName: "MODEL",
      description: "Model to use",
    });
    this._maxTurns = this.defineIntegerParameter({
      parameterLongName: "--max-turns",
      argumentName: "N",
      description: "Maximum number of turns",
    });
    this._runtime = this.defineStringParameter({
      parameterLongName: "--runtime",
      argumentName: "RUNTIME",
      description: "Agent runtime",
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    const session = await client.spawnAgent({
      environmentId: this._environmentId.value!,
      prompt: this._prompt.value!,
      model: this._model.value ?? "",
      maxTurns: this._maxTurns.value ?? 0,
      runtime: this._runtime.value ?? "",
    });
    console.log(`Spawned session: ${session.id}`);
    console.log(`Streaming events (Ctrl+C to detach)...\n`);

    // Auto-attach to stream
    for await (const event of client.streamSession({ id: session.id })) {
      printEvent(event);
    }
  }
}

/** Action: `resume` — resume a suspended session. */
export class ResumeAction extends CommandLineAction {
  private readonly _sessionId: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "resume",
      summary: "Resume a suspended session",
      documentation: "Resumes a previously suspended agent session.",
    });

    this._sessionId = this.defineStringParameter({
      parameterLongName: "--session-id",
      argumentName: "SESSION_ID",
      description: "Session ID to resume",
      required: true,
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    const session = await client.resumeAgent({ sessionId: this._sessionId.value! });
    console.log(`Resumed session: ${session.id}`);
  }
}

/** Action: `status` — list active sessions. */
export class StatusAction extends CommandLineAction {
  private readonly _env: CommandLineStringParameter;
  private readonly _all: CommandLineFlagParameter;

  public constructor() {
    super({
      actionName: "status",
      summary: "List active sessions",
      documentation: "Displays a table of active (or all) agent sessions.",
    });

    this._env = this.defineStringParameter({
      parameterLongName: "--env",
      argumentName: "ENV_ID",
      description: "Filter by environment ID",
    });
    this._all = this.defineFlagParameter({
      parameterLongName: "--all",
      description: "Show all sessions including completed",
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    const res = await client.listSessions({
      environmentId: this._env.value ?? "",
      status: this._all.value ? "" : "active",
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
      table.push([s.id.slice(0, 8), s.environmentId, s.runtime, s.status, prompt, s.startedAt]);
    }
    console.log(table.toString());
  }
}

/** Action: `kill` — terminate a running session. */
export class KillAction extends CommandLineAction {
  private readonly _sessionId: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "kill",
      summary: "Kill a running session",
      documentation: "Terminates a running agent session.",
    });

    this._sessionId = this.defineStringParameter({
      parameterLongName: "--session-id",
      argumentName: "SESSION_ID",
      description: "Session ID to terminate",
      required: true,
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    await client.killAgent({ id: this._sessionId.value! });
    console.log(`Killed: ${this._sessionId.value}`);
  }
}

/** Action: `attach` — attach to a session stream with interactive input. */
export class AttachAction extends CommandLineAction {
  private readonly _sessionId: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "attach",
      summary: "Attach to a session stream with interactive input",
      documentation: "Streams events from a running session and allows sending interactive input.",
    });

    this._sessionId = this.defineStringParameter({
      parameterLongName: "--session-id",
      argumentName: "SESSION_ID",
      description: "Session ID to attach to",
      required: true,
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    const sessionId = this._sessionId.value!;
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
  }
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
