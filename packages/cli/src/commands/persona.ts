import type { Command } from "commander";
import { createGrackleClient } from "../client.js";
import Table from "cli-table3";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { MCP_TOOL_PRESETS, DEFAULT_SCOPED_MCP_TOOLS } from "@grackle-ai/common";

/**
 * Resolve `--mcp-tools` and `--mcp-tools-preset` options into a tool name array.
 * Returns undefined if neither flag was provided.
 */
function resolveMcpTools(opts: { mcpTools?: string; mcpToolsPreset?: string }): string[] | undefined {
  if (opts.mcpTools && opts.mcpToolsPreset) {
    console.error(chalk.red("Cannot specify both --mcp-tools and --mcp-tools-preset."));
    process.exit(1);
  }
  if (opts.mcpToolsPreset) {
    const preset: readonly string[] | undefined =
      (MCP_TOOL_PRESETS as Record<string, readonly string[] | undefined>)[opts.mcpToolsPreset];
    if (!preset) {
      const validPresets = Object.keys(MCP_TOOL_PRESETS).join(", ");
      console.error(chalk.red(`Unknown preset "${opts.mcpToolsPreset}". Valid presets: ${validPresets}`));
      process.exit(1);
    }
    return [...preset];
  }
  if (opts.mcpTools) {
    return opts.mcpTools.split(",").map((t) => t.trim()).filter(Boolean);
  }
  return undefined;
}

/** Register persona management commands: `persona list`, `create`, `show`, `edit`, `delete`. */
export function registerPersonaCommands(program: Command): void {
  const persona = program.command("persona").description("Create and manage agent personas");

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
        head: ["ID", "Name", "Type", "Runtime", "Model", "Max Turns", "Description"],
      });
      for (const p of res.personas) {
        table.push([
          p.id,
          p.name,
          p.type || "agent",
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
    .option("--type <type>", "Persona type: agent or script", "agent")
    .option("--prompt <text>", "System prompt text")
    .option("--prompt-file <path>", "Read system prompt from file")
    .option("--script <code>", "Script source code (for script personas)")
    .option("--script-file <path>", "Read script from file (for script personas)")
    .option("--desc <text>", "Description")
    .option(
      "--runtime <runtime>",
      "Default runtime (claude-code, copilot, codex, goose, genaiscript)",
    )
    .option("--model <model>", "Default model")
    .option("--max-turns <n>", "Maximum turns", parseInt)
    .option("--mcp-tools <tools>", "Comma-separated list of allowed MCP tool names")
    .option("--mcp-tools-preset <preset>", "Use a preset: default, worker, orchestrator, admin")
    .addHelpText("after", `\nExamples:\n  $ grackle persona create "Frontend Engineer" --prompt "You are a React specialist." --runtime claude-code\n  $ grackle persona create "Security Reviewer" --prompt-file ./prompts/security.md --model opus\n  $ grackle persona create "Nightly Report" --type script --script-file ./scripts/report.genai.mjs --runtime genaiscript\n  $ grackle persona create "Worker" --prompt "You are a worker." --mcp-tools-preset worker`)
    .action(async (name: string, opts: {
      type?: string; prompt?: string; promptFile?: string; desc?: string;
      runtime?: string; model?: string; maxTurns?: number;
      script?: string; scriptFile?: string;
      mcpTools?: string; mcpToolsPreset?: string;
    }) => {
      const personaType = opts.type || "agent";

      let systemPrompt = opts.prompt || "";
      if (opts.promptFile) {
        systemPrompt = readFileSync(opts.promptFile, "utf8");
      }

      let scriptContent = opts.script || "";
      if (opts.scriptFile) {
        scriptContent = readFileSync(opts.scriptFile, "utf8");
      }

      if (personaType === "script") {
        if (!scriptContent) {
          console.error(
            chalk.red(
              "Script content is required for script personas. Use --script or --script-file.",
            ),
          );
          process.exit(1);
        }
      } else {
        if (!systemPrompt) {
          console.error(
            chalk.red(
              "System prompt is required. Use --prompt or --prompt-file.",
            ),
          );
          process.exit(1);
        }
      }

      const allowedMcpTools = resolveMcpTools(opts);

      const client = createGrackleClient();
      const p = await client.createPersona({
        name,
        description: opts.desc || "",
        systemPrompt,
        runtime: opts.runtime || (personaType === "script" ? "genaiscript" : ""),
        model: opts.model || "",
        maxTurns: opts.maxTurns || 0,
        type: personaType,
        script: scriptContent,
        allowedMcpTools: allowedMcpTools || [],
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
      console.log(`Type:          ${p.type || "agent"}`);
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
      if (p.allowedMcpTools.length > 0) {
        console.log(`MCP Tools:     ${p.allowedMcpTools.join(", ")}`);
      } else {
        console.log(`MCP Tools:     ${chalk.dim(`default (${DEFAULT_SCOPED_MCP_TOOLS.length} tools)`)}`);
      }
      if (p.mcpServers.length > 0) {
        console.log(`MCP Servers:`);
        for (const s of p.mcpServers) {
          console.log(`  ${s.name}: ${s.command} ${s.args.join(" ")}`);
        }
      }
      if ((p.type || "agent") === "script" && p.script) {
        console.log(`\nScript:\n${chalk.dim("─".repeat(60))}`);
        console.log(p.script);
      } else {
        console.log(`\nSystem Prompt:\n${chalk.dim("─".repeat(60))}`);
        console.log(p.systemPrompt);
      }
    });

  persona
    .command("edit <id>")
    .description("Edit a persona")
    .option("--name <name>", "New name")
    .option("--type <type>", "New type (agent or script)")
    .option("--prompt <text>", "New system prompt")
    .option("--prompt-file <path>", "Read system prompt from file")
    .option("--script <code>", "New script source code")
    .option("--script-file <path>", "Read script from file")
    .option("--desc <text>", "New description")
    .option("--runtime <runtime>", "New runtime")
    .option("--model <model>", "New model")
    .option("--max-turns <n>", "New max turns", parseInt)
    .option("--mcp-tools <tools>", "Comma-separated list of allowed MCP tool names")
    .option("--mcp-tools-preset <preset>", "Use a preset: default, worker, orchestrator, admin")
    .action(async (id: string, opts: {
      name?: string; type?: string; prompt?: string; promptFile?: string;
      desc?: string; runtime?: string; model?: string; maxTurns?: number;
      script?: string; scriptFile?: string;
      mcpTools?: string; mcpToolsPreset?: string;
    }) => {
      let systemPrompt = opts.prompt || "";
      if (opts.promptFile) {
        systemPrompt = readFileSync(opts.promptFile, "utf8");
      }
      let scriptContent = opts.script || "";
      if (opts.scriptFile) {
        scriptContent = readFileSync(opts.scriptFile, "utf8");
      }
      const allowedMcpTools = resolveMcpTools(opts);

      const client = createGrackleClient();
      const p = await client.updatePersona({
        id,
        name: opts.name || "",
        description: opts.desc || "",
        systemPrompt,
        runtime: opts.runtime || "",
        model: opts.model || "",
        maxTurns: opts.maxTurns || 0,
        type: opts.type || "",
        script: scriptContent,
        // Wrapper message with presence: undefined = keep existing, present = replace/clear.
        allowedMcpTools: allowedMcpTools !== undefined ? { tools: allowedMcpTools } : undefined,
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
