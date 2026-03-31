import type { Command } from "commander";
import { createGrackleClients } from "../client.js";
import Table from "cli-table3";
import chalk from "chalk";

/** Register plugin management commands: `plugin list`, `enable`, `disable`. */
export function registerPluginCommands(program: Command): void {
  const plugin = program.command("plugin").description("Manage Grackle plugins");

  plugin
    .command("list")
    .description("List all plugins and their current state")
    .addHelpText("after", "\nExample:\n  $ grackle plugin list")
    .action(async () => {
      const { core: client } = createGrackleClients();
      const res = await client.listPlugins({});
      const table = new Table({
        head: ["Name", "Description", "Enabled", "Loaded", "Required"],
      });
      for (const p of res.plugins) {
        table.push([
          p.name,
          p.description,
          p.enabled ? chalk.green("yes") : chalk.yellow("no"),
          p.loaded ? chalk.green("yes") : chalk.gray("no"),
          p.required ? chalk.blue("yes") : "",
        ]);
      }
      console.log(table.toString());
    });

  plugin
    .command("enable <name>")
    .description("Enable a plugin (requires restart to take effect)")
    .addHelpText("after", "\nExample:\n  $ grackle plugin enable orchestration")
    .action(async (name: string) => {
      const { core: client } = createGrackleClients();
      const res = await client.setPluginEnabled({ name, enabled: true });
      console.log(chalk.green(`Plugin "${res.name}" enabled.`));
      console.log(chalk.yellow("Restart Grackle to apply changes."));
    });

  plugin
    .command("disable <name>")
    .description("Disable a plugin (requires restart to take effect)")
    .addHelpText("after", "\nExample:\n  $ grackle plugin disable orchestration")
    .action(async (name: string) => {
      const { core: client } = createGrackleClients();
      const res = await client.setPluginEnabled({ name, enabled: false });
      console.log(chalk.yellow(`Plugin "${res.name}" disabled.`));
      console.log(chalk.yellow("Restart Grackle to apply changes."));
    });
}
