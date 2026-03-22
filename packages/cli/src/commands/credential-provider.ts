import type { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { createGrackleClient } from "../client.js";
import {
  claudeProviderModeToString,
  providerToggleToString,
} from "@grackle-ai/common";

/** Valid provider names. */
const VALID_PROVIDERS: readonly string[] = ["claude", "github", "copilot", "codex", "goose"];

/** Valid values per provider. */
const VALID_VALUES: Record<string, readonly string[]> = {
  claude: ["off", "subscription", "api_key"],
  github: ["off", "on"],
  copilot: ["off", "on"],
  codex: ["off", "on"],
  goose: ["off", "on"],
};

/** Register the `credential-provider` subcommands on the CLI program. */
export function registerCredentialProviderCommands(program: Command): void {
  const cp = program
    .command("credential-provider")
    .description("Configure credential provider auto-forwarding");

  cp.command("list")
    .description("Show current credential provider configuration")
    .action(async () => {
      const client = createGrackleClient();
      const config = await client.getCredentialProviders({});
      const table = new Table({
        head: ["Provider", "Status"],
      });
      table.push(
        ["claude", claudeProviderModeToString(config.claude) || "off"],
        ["github", providerToggleToString(config.github) || "off"],
        ["copilot", providerToggleToString(config.copilot) || "off"],
        ["codex", providerToggleToString(config.codex) || "off"],
        ["goose", providerToggleToString(config.goose) || "off"],
      );
      console.log(table.toString());
    });

  cp.command("set <provider> <value>")
    .description("Set a credential provider mode (e.g. claude subscription, github on)")
    .action(async (provider: string, value: string) => {
      if (!VALID_PROVIDERS.includes(provider)) {
        console.error(
          chalk.red(`Invalid provider: ${provider}. Must be one of: ${VALID_PROVIDERS.join(", ")}`),
        );
        process.exit(1);
      }

      const allowed = VALID_VALUES[provider];
      if (!allowed.includes(value)) {
        console.error(
          chalk.red(`Invalid value for ${provider}: ${value}. Must be one of: ${allowed.join(", ")}`),
        );
        process.exit(1);
      }

      const client = createGrackleClient();
      const updated = await client.setCredentialProvider({ provider, value });
      console.log(
        chalk.green(`${provider} → ${value}`),
      );
      console.log(
        `  claude: ${claudeProviderModeToString(updated.claude) || "off"}  ` +
        `github: ${providerToggleToString(updated.github) || "off"}  ` +
        `copilot: ${providerToggleToString(updated.copilot) || "off"}  ` +
        `codex: ${providerToggleToString(updated.codex) || "off"}  ` +
        `goose: ${providerToggleToString(updated.goose) || "off"}`,
      );
    });
}
