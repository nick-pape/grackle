import type { Command } from "commander";
import chalk from "chalk";
import { createGrackleClients } from "../client.js";

/** Known setting key aliases mapped to their canonical gRPC key. */
const SETTING_KEY_ALIASES: Record<string, string> = {
  "default-persona": "default_persona_id",
};

/**
 * Resolve a user-friendly setting key (e.g. "default-persona") to the
 * canonical key expected by the gRPC Settings RPCs.  If no alias exists
 * the raw key is passed through unchanged.
 */
function resolveSettingKey(key: string): string {
  return SETTING_KEY_ALIASES[key] ?? key;
}

/** Register configuration commands: `config get`, `config set`. */
export function registerConfigCommands(program: Command): void {
  const config = program
    .command("config")
    .description("Manage app-level settings");

  config
    .command("get <key>")
    .description("Get a setting value")
    .action(async (key: string) => {
      const { core: client } = createGrackleClients();
      const settingKey = resolveSettingKey(key);
      const result = await client.getSetting({ key: settingKey });
      if (result.value) {
        console.log(result.value);
      } else {
        console.log(chalk.gray("(not set)"));
      }
    });

  config
    .command("set <key> <value>")
    .description("Set a setting value")
    .action(async (key: string, value: string) => {
      const { core: client } = createGrackleClients();
      const settingKey = resolveSettingKey(key);
      await client.setSetting({ key: settingKey, value });
      console.log(`Set ${chalk.bold(key)} = ${chalk.cyan(value)}`);
    });
}
