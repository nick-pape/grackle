/**
 * CLI commands for managing multiple GitHub accounts in Grackle.
 *
 * Allows registering PATs under human-readable labels, setting a default
 * account, importing accounts from `gh auth status`, and removing accounts.
 */
import type { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { createGrackleClients } from "../client.js";

/** Register the `github-account` subcommands on the CLI program. */
export function registerGitHubAccountCommands(program: Command): void {
  const ga = program
    .command("github-account")
    .description("Manage GitHub account credentials for multi-identity support");

  ga.command("list")
    .description("List all registered GitHub accounts")
    .action(async () => {
      const { core: client } = createGrackleClients();
      const { accounts } = await client.listGitHubAccounts({});
      if (accounts.length === 0) {
        console.log(chalk.dim("No GitHub accounts registered. Use `grackle github-account add` to add one."));
        return;
      }
      const table = new Table({
        head: ["Label", "Username", "Default", "Created"],
      });
      for (const account of accounts) {
        table.push([
          account.label,
          account.username || chalk.dim("(unknown)"),
          account.isDefault ? chalk.green("✓") : "",
          account.createdAt ? account.createdAt.slice(0, 10) : "",
        ]);
      }
      console.log(table.toString());
    });

  ga.command("add <label>")
    .description("Register a GitHub account with a personal access token")
    .requiredOption("--token <token>", "GitHub personal access token (PAT)")
    .option("--username <username>", "GitHub username (resolved automatically if omitted)")
    .option("--default", "Set as the default account")
    .action(async (label: string, opts: { token: string; username?: string; default?: boolean }) => {
      if (!label.trim()) {
        console.error(chalk.red("Label cannot be empty"));
        process.exit(1);
      }
      const { core: client } = createGrackleClients();
      const account = await client.addGitHubAccount({
        label: label.trim(),
        token: opts.token,
        username: opts.username || "",
        isDefault: opts.default ?? false,
      });
      console.log(
        chalk.green(`✓ Added GitHub account '${account.label}'`) +
        (account.username ? ` (${account.username})` : "") +
        (account.isDefault ? chalk.dim(" [default]") : ""),
      );
    });

  ga.command("remove <label-or-id>")
    .description("Remove a registered GitHub account")
    .action(async (labelOrId: string) => {
      const { core: client } = createGrackleClients();
      // Try to resolve by listing and matching label first
      const { accounts } = await client.listGitHubAccounts({});
      const match = accounts.find(
        (a) => a.id === labelOrId || a.label.toLowerCase() === labelOrId.toLowerCase(),
      );
      if (!match) {
        console.error(chalk.red(`GitHub account not found: ${labelOrId}`));
        process.exit(1);
      }
      await client.removeGitHubAccount({ id: match.id });
      console.log(chalk.green(`✓ Removed GitHub account '${match.label}'`));
    });

  ga.command("set-default <label-or-id>")
    .description("Set a GitHub account as the default")
    .action(async (labelOrId: string) => {
      const { core: client } = createGrackleClients();
      const { accounts } = await client.listGitHubAccounts({});
      const match = accounts.find(
        (a) => a.id === labelOrId || a.label.toLowerCase() === labelOrId.toLowerCase(),
      );
      if (!match) {
        console.error(chalk.red(`GitHub account not found: ${labelOrId}`));
        process.exit(1);
      }
      const updated = await client.updateGitHubAccount({ id: match.id, isDefault: true });
      console.log(chalk.green(`✓ '${updated.label}' is now the default GitHub account`));
    });

  ga.command("import")
    .description("Import accounts from the local `gh` CLI authentication state")
    .action(async () => {
      const { core: client } = createGrackleClients();
      const result = await client.importGitHubAccounts({});
      if (result.imported === 0) {
        console.log(chalk.dim("No new accounts to import (all accounts already registered, or gh CLI not available)."));
      } else {
        console.log(chalk.green(`✓ Imported ${result.imported} account(s): ${result.usernames.join(", ")}`));
      }
    });
}
