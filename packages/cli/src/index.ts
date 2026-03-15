#!/usr/bin/env node

import { Command } from "commander";
import { ConnectError, Code } from "@connectrpc/connect";
import { createRequire } from "node:module";
import chalk from "chalk";
import { registerEnvCommands } from "./commands/env.js";
import { registerAgentCommands } from "./commands/agent.js";
import { registerTokenCommands } from "./commands/token.js";
import { registerLogCommands } from "./commands/logs.js";
import { registerServeCommand } from "./commands/serve.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerTaskCommands } from "./commands/task.js";
import { registerFindingCommands } from "./commands/findings.js";
import { registerPersonaCommands } from "./commands/persona.js";
import { renderBanner, getHelpFooter } from "./banner.js";

const esmRequire: NodeRequire = createRequire(import.meta.url);
const { version } = esmRequire("../package.json") as { version: string };

const program: Command = new Command();

program
  .name("grackle")
  .description("AI agent orchestration from the command line")
  .option("-V, --version", "output the version with banner")
  .on("option:version", () => {
    console.log(renderBanner(version));
    process.exit(0);
  });

program.addHelpText("beforeAll", (context) => {
  if (context.command !== program) {
    return "";
  }
  return renderBanner(version);
});

program.addHelpText("after", (context) => {
  if (context.command !== program) {
    return "";
  }
  return getHelpFooter();
});

registerEnvCommands(program);
registerAgentCommands(program);
registerTokenCommands(program);
registerLogCommands(program);
registerServeCommand(program);
registerProjectCommands(program);
registerTaskCommands(program);
registerFindingCommands(program);
registerPersonaCommands(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof ConnectError) {
    console.error(
      chalk.red(`gRPC error [${Code[err.code]}]: ${err.rawMessage}`),
    );
    if (err.code === Code.Unavailable) {
      console.error(
        "Is the Grackle server running? Start it with: grackle serve",
      );
    }
  } else if (err instanceof Error) {
    console.error(chalk.red(err.message));
  } else {
    console.error(chalk.red(String(err)));
  }
  process.exit(1);
});
