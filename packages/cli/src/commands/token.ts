import type { Command } from "commander";
import { createGrackleClient } from "../client.js";
import Table from "cli-table3";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

/** Register the `token set` and `token list` subcommands on the CLI program. */
export function registerTokenCommands(program: Command): void {
  const token = program.command("token").description("Manage auth tokens");

  token
    .command("set <name>")
    .description("Set a token")
    .option("--file <path>", "Read value from file")
    .option("--env <var>", "Read value from environment variable")
    .option("--type <type>", "Token type: env_var or file", "env_var")
    .option("--env-var <name>", "Environment variable name to set on PowerLine")
    .option("--file-path <path>", "File path to write on PowerLine")
    .action(async (name: string, opts) => {
      const client = createGrackleClient();
      let value: string;

      if (opts.file) {
        value = readFileSync(opts.file, "utf-8").trim();
      } else if (opts.env) {
        value = process.env[opts.env] || "";
        if (!value) {
          console.error(`Environment variable ${opts.env} is not set`);
          process.exit(1);
        }
      } else {
        // Interactive
        value = await new Promise<string>((resolve) => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          rl.question(`Enter value for ${name}: `, (answer) => {
            rl.close();
            resolve(answer);
          });
        });
      }

      await client.setToken({
        name,
        type: opts.type,
        envVar: opts.envVar || name.toUpperCase() + "_TOKEN",
        filePath: opts.filePath || "",
        value,
        expiresAt: "",
      });
      console.log(`Token set: ${name}`);
    });

  token
    .command("list")
    .description("List configured tokens")
    .action(async () => {
      const client = createGrackleClient();
      const res = await client.listTokens({});
      if (res.tokens.length === 0) {
        console.log("No tokens configured.");
        return;
      }
      const table = new Table({
        head: ["Name", "Type", "Target", "Expires"],
      });
      for (const t of res.tokens) {
        const target = t.type === "env_var" ? t.envVar : t.filePath;
        table.push([t.name, t.type, target, t.expiresAt || "never"]);
      }
      console.log(table.toString());
    });
}
