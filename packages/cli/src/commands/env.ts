import type { Command } from "commander";
import chalk from "chalk";
import { createGrackleClient } from "../client.js";
import { grackle, environmentStatusToString, type AdapterType } from "@grackle-ai/common";
import Table from "cli-table3";

/** Register environment management commands: `env list`, `add`, `provision`, `stop`, `destroy`, `remove`, `wake`. */
export function registerEnvCommands(program: Command): void {
  const env = program.command("env").description("Manage environments");

  env
    .command("list")
    .description("List all environments")
    .action(async () => {
      const client = createGrackleClient();
      const res = await client.listEnvironments({});
      if (res.environments.length === 0) {
        console.log("No environments configured.");
        return;
      }
      const table = new Table({
        head: ["ID", "Type", "Runtime", "Status", "Bootstrapped"],
      });
      for (const e of res.environments) {
        const statusStr = environmentStatusToString(e.status);
        const status = e.status === grackle.EnvironmentStatus.CONNECTED ? chalk.green("●") + " " + statusStr :
                       e.status === grackle.EnvironmentStatus.SLEEPING ? chalk.yellow("●") + " " + statusStr :
                       e.status === grackle.EnvironmentStatus.ERROR ? chalk.red("●") + " " + statusStr :
                       chalk.gray("●") + " " + statusStr;
        table.push([e.id, e.adapterType, e.defaultRuntime, status, e.bootstrapped ? "yes" : "no"]);
      }
      console.log(table.toString());
    });

  env
    .command("add <name>")
    .description("Add an environment")
    .option("--codespace", "Codespace adapter")
    .option("--docker", "Docker adapter")
    .option("--ssh", "SSH adapter")
    .option("--local", "Local PowerLine adapter")
    .option("--repo <repo>", "GitHub repo to clone (docker)")
    .option("--image <image>", "Docker image")
    .option("--host <host>", "SSH host / local host")
    .option("--port <port>", "PowerLine port (local adapter)")
    .option("--user <user>", "SSH user")
    .option("--ssh-port <sshPort>", "SSH port (default: 22)")
    .option("--identity-file <path>", "SSH identity file (private key)")
    .option("--codespace-name <name>", "Codespace name (from `gh codespace list`)")
    .option("--runtime <runtime>", "Default runtime", "claude-code")
    .action(async (name: string, opts) => {
      const client = createGrackleClient();
      let adapterType: AdapterType = "docker";
      const config: Record<string, unknown> = {};

      if (opts.local) {
        adapterType = "local";
        if (opts.host) config.host = opts.host;
        if (opts.port) config.port = parseInt(opts.port, 10);
      } else if (opts.codespace) {
        adapterType = "codespace";
        if (opts.codespaceName) {
          config.codespaceName = opts.codespaceName;
        } else {
          console.error("Error: --codespace requires --codespace-name <name>");
          process.exit(1);
        }
      } else if (opts.ssh) {
        adapterType = "ssh";
        if (!opts.host) {
          console.error("Error: --ssh requires --host <host>");
          process.exit(1);
        }
        config.host = opts.host;
        if (opts.user) config.user = opts.user;
        if (opts.sshPort) {
          const port = parseInt(opts.sshPort, 10);
          if (isNaN(port) || port < 1 || port > 65535) {
            console.error("Error: --ssh-port must be a number between 1 and 65535");
            process.exit(1);
          }
          config.sshPort = port;
        }
        if (opts.identityFile) config.identityFile = opts.identityFile;
      } else {
        if (opts.image) config.image = opts.image;
        if (opts.repo) config.repo = opts.repo;
      }

      const env = await client.addEnvironment({
        displayName: name,
        adapterType,
        adapterConfig: JSON.stringify(config),
        defaultRuntime: opts.runtime,
      });
      console.log(`Added environment: ${env.id} (${env.adapterType})`);
    });

  env
    .command("provision <id>")
    .description("Provision and connect an environment")
    .action(provisionAction);

  env
    .command("stop <id>")
    .description("Stop an environment")
    .action(async (id: string) => {
      const client = createGrackleClient();
      await client.stopEnvironment({ id });
      console.log(`Stopped: ${id}`);
    });

  env
    .command("destroy <id>")
    .description("Destroy an environment")
    .action(async (id: string) => {
      const client = createGrackleClient();
      await client.destroyEnvironment({ id });
      console.log(`Destroyed: ${id}`);
    });

  env
    .command("remove <id>")
    .description("Remove environment from registry")
    .action(async (id: string) => {
      const client = createGrackleClient();
      await client.removeEnvironment({ id });
      console.log(`Removed: ${id}`);
    });

  /** Shared action for provisioning / waking an environment. */
  async function provisionAction(id: string): Promise<void> {
    const client = createGrackleClient();
    for await (const event of client.provisionEnvironment({ id })) {
      const pct = Math.round(event.progress * 100);
      console.log(`[${pct}%] ${event.stage}: ${event.message}`);
    }
  }

  env
    .command("wake <id>")
    .description("Wake a sleeping environment")
    .action(provisionAction);
}
