#!/usr/bin/env node

import { CommandLineParser } from "@rushstack/ts-command-line";
import {
  EnvListAction,
  EnvAddAction,
  EnvProvisionAction,
  EnvStopAction,
  EnvDestroyAction,
  EnvRemoveAction,
  EnvWakeAction,
} from "./commands/env.js";
import {
  SpawnAction,
  ResumeAction,
  StatusAction,
  KillAction,
  AttachAction,
} from "./commands/agent.js";
import { TokenSetAction, TokenListAction } from "./commands/token.js";
import { LogsAction } from "./commands/logs.js";
import { ServeAction } from "./commands/serve.js";
import { ProjectListAction, ProjectCreateAction, ProjectArchiveAction } from "./commands/project.js";
import {
  TaskListAction,
  TaskCreateAction,
  TaskShowAction,
  TaskStartAction,
  TaskDeleteAction,
  TaskApproveAction,
  TaskRejectAction,
} from "./commands/task.js";
import { FindingListAction, FindingPostAction } from "./commands/findings.js";

/** The main command-line parser for the Grackle CLI. */
class GrackleCommandLine extends CommandLineParser {
  public constructor() {
    super({
      toolFilename: "grackle",
      toolDescription: "Multiplexed interface for AI coding agent sessions",
    });

    this.addAction(new EnvListAction());
    this.addAction(new EnvAddAction());
    this.addAction(new EnvProvisionAction());
    this.addAction(new EnvStopAction());
    this.addAction(new EnvDestroyAction());
    this.addAction(new EnvRemoveAction());
    this.addAction(new EnvWakeAction());

    this.addAction(new SpawnAction());
    this.addAction(new ResumeAction());
    this.addAction(new StatusAction());
    this.addAction(new KillAction());
    this.addAction(new AttachAction());

    this.addAction(new TokenSetAction());
    this.addAction(new TokenListAction());

    this.addAction(new LogsAction());
    this.addAction(new ServeAction());

    this.addAction(new ProjectListAction());
    this.addAction(new ProjectCreateAction());
    this.addAction(new ProjectArchiveAction());

    this.addAction(new TaskListAction());
    this.addAction(new TaskCreateAction());
    this.addAction(new TaskShowAction());
    this.addAction(new TaskStartAction());
    this.addAction(new TaskDeleteAction());
    this.addAction(new TaskApproveAction());
    this.addAction(new TaskRejectAction());

    this.addAction(new FindingListAction());
    this.addAction(new FindingPostAction());
  }
}

async function main(): Promise<void> {
  const cli = new GrackleCommandLine();
  await cli.executeAsync();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
