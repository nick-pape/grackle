import type { Command } from "commander";
import chalk from "chalk";
import { createGrackleClients } from "../client.js";
import type { AdapterType } from "@grackle-ai/common";
import Table from "cli-table3";

/** Register environment management commands: `env list`, `add`, `provision`, `stop`, `destroy`, `remove`, `wake`. */
export function registerEnvCommands(program: Command): void {
  const env = program.command("env").description("Add, provision, and manage environments");

  env
    .command("list")
    .description("List all environments")
    .action(async () => {
      const { core: client } = createGrackleClients();
      const res = await client.listEnvironments({});
      if (res.environments.length === 0) {
        console.log("No environments configured.");
        return;
      }
      const table = new Table({
        head: ["ID", "Type", "Status", "Bootstrapped"],
      });
      for (const e of res.environments) {
        const status = e.status === "connected" ? chalk.green("●") + " " + e.status :
                       e.status === "sleeping" ? chalk.yellow("●") + " " + e.status :
                       e.status === "error" ? chalk.red("●") + " " + e.status :
                       chalk.gray("●") + " " + e.status;
        table.push([e.id, e.adapterType, status, e.bootstrapped ? "yes" : "no"]);
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
    .option("--volume <volumes...>", "Docker volume mounts (format: host:container[:ro])")
    .option("--gpu [gpus]", "Enable GPU passthrough (default: all)")
    .option("--ssh-port <sshPort>", "SSH port (default: 22)")
    .option("--identity-file <path>", "SSH identity file (private key)")
    .option("--codespace-name <name>", "Codespace name (from `gh codespace list`)")
    .option("--github-account <label>", "GitHub account label to use for gh CLI operations (codespace/docker adapters)")
    .action(async (name: string, opts: {
      codespace?: boolean; docker?: boolean; ssh?: boolean; local?: boolean;
      repo?: string; image?: string; host?: string; port?: string; user?: string;
      volume?: string[]; gpu?: string | boolean; sshPort?: string;
      identityFile?: string; codespaceName?: string; githubAccount?: string;
    }) => {
      const { core: client } = createGrackleClients();
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
        if (opts.volume) config.volumes = opts.volume;
        if (opts.gpu) config.gpus = opts.gpu === true ? "all" : opts.gpu;
      }

      // Resolve --github-account label to an account ID, if provided.
      // The flag is only meaningful for adapters that use `gh` CLI (codespace/docker).
      let githubAccountId = "";
      if (opts.githubAccount) {
        if (adapterType !== "codespace" && adapterType !== "docker") {
          console.error(chalk.yellow(`Warning: --github-account has no effect for the "${adapterType}" adapter (only applies to codespace/docker)`));
        } else {
          const { accounts } = await client.listGitHubAccounts({});
          const match = accounts.find(
            (a) => a.id === opts.githubAccount || a.label.toLowerCase() === (opts.githubAccount ?? "").toLowerCase(),
          );
          if (!match) {
            console.error(chalk.red(`GitHub account not found: ${opts.githubAccount}`));
            process.exit(1);
          }
          githubAccountId = match.id;
        }
      }

      const env: { id: string; adapterType: string } = await client.addEnvironment({
        displayName: name,
        adapterType,
        adapterConfig: JSON.stringify(config),
        githubAccountId,
      });
      console.log(`Added environment: ${env.id} (${env.adapterType})`);
    });

  env
    .command("provision <id>")
    .description("Provision and connect an environment")
    .option("--force", "Force full reprovision, killing active sessions")
    .action(provisionAction);

  env
    .command("stop <id>")
    .description("Stop an environment")
    .action(async (id: string) => {
      const { core: client } = createGrackleClients();
      await client.stopEnvironment({ id });
      console.log(`Stopped: ${id}`);
    });

  env
    .command("destroy <id>")
    .description("Destroy an environment")
    .action(async (id: string) => {
      const { core: client } = createGrackleClients();
      await client.destroyEnvironment({ id });
      console.log(`Destroyed: ${id}`);
    });

  env
    .command("remove <id>")
    .description("Remove environment from registry")
    .action(async (id: string) => {
      const { core: client } = createGrackleClients();
      await client.removeEnvironment({ id });
      console.log(`Removed: ${id}`);
    });

  /** Shared action for provisioning / waking an environment. */
  async function provisionAction(id: string, options: { force?: boolean } = {}): Promise<void> {
    const { core: client } = createGrackleClients();
    for await (const event of client.provisionEnvironment({ id, force: options.force ?? false })) {
      const pct = Math.round(event.progress * 100);
      console.log(`[${pct}%] ${event.stage}: ${event.message}`);
    }
  }

  env
    .command("wake <id>")
    .description("Wake a sleeping environment")
    .action(provisionAction);
}
