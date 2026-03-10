#!/usr/bin/env node

import { Command } from "commander";
import { createRequire } from "node:module";
import { registerEnvCommands } from "./commands/env.js";
import { registerAgentCommands } from "./commands/agent.js";
import { registerTokenCommands } from "./commands/token.js";
import { registerLogCommands } from "./commands/logs.js";
import { registerServeCommand } from "./commands/serve.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerTaskCommands } from "./commands/task.js";
import { registerFindingCommands } from "./commands/findings.js";

const esmRequire: NodeRequire = createRequire(import.meta.url);
const { version } = esmRequire("../package.json") as { version: string };

const program: Command = new Command();

program
  .name("grackle")
  .description("Multiplexed interface for AI coding agent sessions")
  .version(version);

registerEnvCommands(program);
registerAgentCommands(program);
registerTokenCommands(program);
registerLogCommands(program);
registerServeCommand(program);
registerProjectCommands(program);
registerTaskCommands(program);
registerFindingCommands(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
