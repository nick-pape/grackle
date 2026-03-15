import type { Command } from "commander";
import { createGrackleClient } from "../client.js";
import Table from "cli-table3";
import chalk from "chalk";
import { readFileSync } from "node:fs";

/** Register persona management commands: `persona list`, `create`, `show`, `edit`, `delete`. */
export function registerPersonaCommands(program: Command): void {
  const persona = program.command("persona").description("Manage personas");

  persona
    .command("list")
    .description("List all personas")
    .addHelpText("after", "\nExample:\n  $ grackle persona list")
    .action(async () => {
      const client = createGrackleClient();
      const res = await client.listPersonas({});
      if (res.personas.length === 0) {
        console.log("No personas.");
        return;
      }
      const table = new Table({
        head: ["ID", "Name", "Runtime", "Model", "Max Turns", "Description"],
      });
      for (const p of res.personas) {
        table.push([
          p.id,
          p.name,
          p.runtime || "-",
          p.model || "-",
          p.maxTurns || "-",
          (p.description || "").slice(0, 40),
        ]);
      }
      console.log(table.toString());
    });

  persona
    .command("create <name>")
    .description("Create a persona")
    .option("--prompt <text>", "System prompt text")
    .option("--prompt-file <path>", "Read system prompt from file")
    .option("--desc <text>", "Description")
    .option(
      "--runtime <runtime>",
      "Default runtime (claude-code, copilot, codex)",
    )
    .option("--model <model>", "Default model")
    .option("--max-turns <n>", "Maximum turns", parseInt)
    .addHelpText("after", `\nExamples:\n  $ grackle persona create "Frontend Engineer" --prompt "You are a React specialist." --runtime claude-code\n  $ grackle persona create "Security Reviewer" --prompt-file ./prompts/security.md --model opus`)
    .action(async (name: string, opts: {
      prompt?: string; promptFile?: string; desc?: string;
      runtime?: string; model?: string; maxTurns?: number;
    }) => {
      let systemPrompt = opts.prompt ?? "";
      if (opts.promptFile) {
        systemPrompt = readFileSync(opts.promptFile, "utf8");
      }
      if (!systemPrompt) {
        console.error(
          chalk.red(
            "System prompt is required. Use --prompt or --prompt-file.",
          ),
        );
        process.exit(1);
      }
      const client = createGrackleClient();
      const p = await client.createPersona({
        name,
        description: opts.desc ?? "",
        systemPrompt,
        runtime: opts.runtime ?? "",
        model: opts.model ?? "",
        maxTurns: opts.maxTurns ?? 0,
      });
      console.log(`Created persona: ${p.id} (${p.name})`);
    });

  persona
    .command("show <id>")
    .description("Show persona details")
    .action(async (id: string) => {
      const client = createGrackleClient();
      const p = await client.getPersona({ id });
      console.log(`ID:            ${p.id}`);
      console.log(`Name:          ${p.name}`);
      console.log(`Description:   ${p.description || "-"}`);
      console.log(`Runtime:       ${p.runtime || "-"}`);
      console.log(`Model:         ${p.model || "-"}`);
      console.log(`Max Turns:     ${p.maxTurns || "-"}`);
      if (p.toolConfig) {
        if (p.toolConfig.allowedTools.length > 0) {
          console.log(`Allowed Tools: ${p.toolConfig.allowedTools.join(", ")}`);
        }
        if (p.toolConfig.disallowedTools.length > 0) {
          console.log(
            `Blocked Tools: ${p.toolConfig.disallowedTools.join(", ")}`,
          );
        }
      }
      if (p.mcpServers.length > 0) {
        console.log(`MCP Servers:`);
        for (const s of p.mcpServers) {
          console.log(`  ${s.name}: ${s.command} ${s.args.join(" ")}`);
        }
      }
      console.log(`\nSystem Prompt:\n${chalk.dim("─".repeat(60))}`);
      console.log(p.systemPrompt);
    });

  persona
    .command("edit <id>")
    .description("Edit a persona")
    .option("--name <name>", "New name")
    .option("--prompt <text>", "New system prompt")
    .option("--prompt-file <path>", "Read system prompt from file")
    .option("--desc <text>", "New description")
    .option("--runtime <runtime>", "New runtime")
    .option("--model <model>", "New model")
    .option("--max-turns <n>", "New max turns", parseInt)
    .action(async (id: string, opts: {
      name?: string; prompt?: string; promptFile?: string; desc?: string;
      runtime?: string; model?: string; maxTurns?: number;
    }) => {
      let systemPrompt = opts.prompt ?? "";
      if (opts.promptFile) {
        systemPrompt = readFileSync(opts.promptFile, "utf8");
      }
      const client = createGrackleClient();
      const p = await client.updatePersona({
        id,
        name: opts.name ?? "",
        description: opts.desc ?? "",
        systemPrompt,
        runtime: opts.runtime ?? "",
        model: opts.model ?? "",
        maxTurns: opts.maxTurns ?? 0,
      });
      console.log(`Updated persona: ${p.id} (${p.name})`);
    });

  persona
    .command("delete <id>")
    .description("Delete a persona")
    .action(async (id: string) => {
      const client = createGrackleClient();
      await client.deletePersona({ id });
      console.log(`Deleted persona: ${id}`);
    });
}
